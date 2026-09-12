# IdeaGen Pro: Architecture, Engineering, and Debugging Reference

This document serves as a comprehensive reference guide for the **IdeaGen Pro** SaaS application. It details the technical design, request lifecycle, authentication and billing mechanisms, failure modes encountered, root cause analysis, and production AI engineering lessons learned during development and debugging.

---

## 1. Executive Overview

### What We Are Building
**IdeaGen Pro** is a full-stack, AI-powered Software-as-a-Service (SaaS) application that generates structured, practical business ideas tailored for the emerging AI agent economy.

### Purpose of the Project
The project demonstrates a production-grade pattern for modern AI web applications:
* Decoupling the user interface from AI inference logic.
* Offloading identity management and recurring subscriptions to managed services (Clerk & Clerk Billing).
* Streaming generative model responses in real-time to create a responsive user experience.
* Hosting a hybrid polyglot architecture (Node.js/TypeScript frontend + Python/FastAPI backend) seamlessly on a single cloud platform (Vercel).

### What the User Can Do
1. **Unauthenticated Visitors**: Land on the marketing page (`/`), view product features, and trigger a modal sign-up/sign-in flow.
2. **Authenticated Free Users**: Access `/`, generate AI business ideas limited to a concise format (400-word limit), and view available upgrade options.
3. **Authenticated Premium Users**: Access comprehensive, in-depth AI business idea generation without word count constraints.
4. **Subscription Management (`/product`)**: View plan tiers via Clerk's interactive Pricing Table, initiate upgrades, or navigate back to the generator.

### Technologies Used

| Layer | Technology | Version / Specification | Role |
|---|---|---|---|
| **Frontend Framework** | Next.js (Pages Router) | `^15.5.25` (React 19) | Server-rendered pages, static assets, routing |
| **Language & Styling** | TypeScript / Tailwind CSS | TS `^5`, Tailwind `^4` | Type-safe UI components, typography, responsive styling |
| **Markdown Rendering** | `react-markdown` + plugins | GFM & Breaks | Renders streamed AI markdown responses |
| **Client Streaming** | `@microsoft/fetch-event-source` | `^2.0.1` | SSE client supporting custom headers (Authorization) |
| **Authentication & Billing** | Clerk & Clerk Billing | `@clerk/nextjs ^6.39.0` | JWT auth, session management, billing plans, pricing table |
| **Backend API** | FastAPI + Uvicorn | `fastapi 0.141`, `uvicorn 0.52` | Python ASGI REST API, route handlers, SSE streaming |
| **Backend Auth Guard** | `fastapi-clerk-auth` | `0.0.9` | Clerk JWKS verification, RS256 token decode dependency |
| **LLM Inference** | OpenAI Python SDK | `openai 3.13.0` | Streaming chat completions (`gpt-5-nano`) |
| **Hosting & Functions** | Vercel Platform | Serverless Functions | Edge deployment, Python ASGI runtime (`@vercel/python`) |

---

## 2. Learning Objectives

This project provides practical experience with production AI engineering patterns:

1. **Polyglot Monorepo Architecture**: Combining the rapid UI development of Next.js with Python's rich AI/data ecosystem without maintaining separate hosting infrastructures.
2. **True Defense-in-Depth Security**: Understanding why client-side authentication checks (`<SignedIn>`, `<Protect>`) are purely for user experience, while backend token validation (FastAPI + JWKS) is mandatory for API security.
3. **Entitlement & Tier-Based Prompting**: Bridging billing state to LLM inference by modifying system prompts and generation limits dynamically based on verified subscription items.
4. **Streaming Protocol Dynamics**: Implementing Server-Sent Events (SSE) from an asynchronous Python generator through cloud serverless proxies to browser clients.
5. **Production Debugging Disciplines**: Diagnosing interactions between platform routing rules, serverless bundling, C-extension compilation, and third-party Web Application Firewalls (WAFs).

---

## 3. High-Level Architecture

### System Architecture Diagram

```
+---------------------------------------------------------------------------------+
|                                    BROWSER                                      |
|                                                                                 |
|   +------------------------------------+   +--------------------------------+   |
|   |         pages/index.tsx            |   |       pages/product.tsx        |   |
|   |   (Landing Page / Generator UI)    |   |     (Clerk Pricing Table)      |   |
|   +------------------------------------+   +--------------------------------+   |
|                     |                                     |                     |
|           getToken()| [Clerk Session JWT]                 | Upgrade Plan        |
|                     v                                     v                     |
|             fetchEventSource('/api')              Clerk Billing Checkout        |
+---------------------|-------------------------------------|---------------------+
                      | HTTPS GET /api                      |
                      | Authorization: Bearer <JWT>         |
                      v                                     |
+-----------------------------------------------------------|---------------------+
|                                VERCEL PLATFORM            |                     |
|                                                           |                     |
|  +--------------------------------+                       |                     |
|  |     Next.js Serverless         |                       |                     |
|  |  Serves: /, /product, static   |                       |                     |
|  +--------------------------------+                       |                     |
|                                                           |                     |
|  +--------------------------------------------------------|------------------+  |
|  |     Python Serverless Function (api/index.py)          |                  |  |
|  |                                                        |                  |  |
|  |   1. clerk_guard (FastAPI Dependency)                  |                  |  |
|  |      - Intercepts Authorization header                 |                  |  |
|  |      - Validates JWT against Clerk JWKS                |                  |  |
|  |                                                        |                  |  |
|  |   2. get_user_subscription(user_id)                   |                  |  |
|  |      - Queries Clerk Billing API via HTTPS             |                  |  |
|  |      - Inspects subscription_items & plan slug         |                  |  |
|  |                                                        |                  |  |
|  |   3. Prompt Selection                                  |                  |  |
|  |      - Free: 400-word limit                            |                  |  |
|  |      - Premium: In-depth comprehensive                 |                  |  |
|  |                                                        |                  |  |
|  |   4. StreamingResponse (text/event-stream)             |                  |  |
|  +--------------------------------------------------------|------------------+  |
+-----------------------------------------------------------|---------------------+
                   |                             |          |
                   | JWKS Fetch &                | SSE      | Stripe /
                   | Billing Query               | Chunks   | Card Processor
                   v                             v          v
     +--------------------------+   +--------------------------+
     |        CLERK API         |   |        OPENAI API        |
     |   - JWKS Public Keys     |   |   - model: gpt-5-nano    |
     |   - Subscription Store   |   |   - chat.completions     |
     +--------------------------+   +--------------------------+
```

### Request / Response Flow Step-by-Step

1. **Authentication**: User logs into the application using Clerk's UI component (`<SignInButton>` / modal). The browser receives a signed session token.
2. **Token Retrieval**: `pages/index.tsx` invokes `const jwt = await getToken()` to obtain a fresh RS256 JWT from the Clerk client runtime.
3. **API Request**: The client issues an HTTP `GET /api` request using `fetchEventSource`, passing the JWT in the `Authorization: Bearer <jwt>` header and specifying `Accept: text/event-stream`.
4. **Vercel Routing**: Vercel routes `/api` directly to the serverless Python ASGI handler defined in `api/index.py`.
5. **Token Verification**: FastAPI passes the request to `clerk_guard` (`ClerkHTTPBearer`). It verifies token signature against `CLERK_JWKS_URL`, checks expiration (`exp`), and decodes claims. The subject claim (`sub`) contains the Clerk User ID.
6. **Subscription Inspection**: FastAPI invokes `get_user_subscription(user_id)`. Using `CLERK_SECRET_KEY` and an explicit User-Agent header, it calls Clerk's Billing API to retrieve active subscription records.
7. **Tier Authorization**: The backend checks whether `subscription_items` contains an active paid plan (`slug == "premium_subscription"`). If not, it defaults to the Free plan.
8. **Inference Request**: The backend builds a tier-specific prompt and calls OpenAI's chat completions API with `stream=True` using model `gpt-5-nano`.
9. **Streaming Delivery**: As OpenAI returns incremental delta chunks, FastAPI wraps them in the SSE wire format (`data: <text>\n\n`) and streams them through `StreamingResponse(..., media_type="text/event-stream")`.
10. **Client Rendering**: `fetchEventSource`'s `onmessage` handler buffers chunks and updates React state, continuously re-rendering markdown in real-time.

### Understanding Streaming (SSE vs Polling / Buffering)
Traditional HTTP request/response requires the server to generate the entire LLM response (often taking 5 to 20 seconds) before sending a single byte back to the browser. 

* **Server-Sent Events (SSE)** maintains a persistent, unidirectional HTTP connection from server to client over standard HTTP/1.1 or HTTP/2.
* When the LLM outputs tokens, the server immediately flushes them across the open connection.
* **Result**: Time-to-First-Token (TTFT) drops to sub-second levels, providing immediate feedback to the user while full generation completes in the background.

---

## 4. Component-by-Component Explanation

### Next.js Pages Router
* Uses file-system routing based on the `pages/` directory.
* Manages global page layouts, document metadata, font optimization, and client-side page transitions.

### `pages/index.tsx`
* Acts as the main entry point for the application.
* Uses Clerk conditional wrappers:
  * `<SignedOut>`: Displays marketing hero, trial messaging, and sign-in button.
  * `<SignedIn>`: Mounts the `<IdeaGenerator />` component.
* Manages SSE lifecycle via `@microsoft/fetch-event-source`, buffering incoming delta text into React state and rendering it through `react-markdown`.

### `pages/product.tsx`
* The pricing and tier navigation page.
* Mounts Clerk's `<PricingTable />` allowing users to view and purchase subscriptions.
* Wraps contents in Clerk's `<Protect plan="premium_subscription">` component:
  * If the user holds a premium entitlement, displays a dedicated premium generator interface.
  * If unentitled, falls back to the pricing table with a "Continue with Free" navigation link.

### FastAPI
* High-performance, type-hinted ASGI Python web framework.
* Provides declarative dependency injection (`Depends`) used for authentication guards, automatic OpenAPI documentation, and native async streaming support via `StreamingResponse`.

### `api/index.py`
* The unified backend entrypoint executed by Vercel's Python runtime.
* Houses:
  * Clerk JWKS configuration (`ClerkConfig`).
  * JWT authentication barrier (`ClerkHTTPBearer`).
  * Server-to-server subscription verification (`get_user_subscription`).
  * Prompt assembly, OpenAI client initialization, and SSE generator loop.

### Clerk Authentication
* Provides identity management, user registration, multi-factor authentication, and session issuance.
* Issues cryptographically signed RS256 JWTs verifying user identity across domain boundaries.

### Clerk Billing
* Managed subscription billing extension for Clerk.
* Manages plan definitions (`free_user`, `premium_subscription`), recurring intervals, checkout sessions, and user entitlement assignment.

### OpenAI
* The LLM inference provider.
* Receives structured prompts and streams completion deltas using model `gpt-5-nano`.

### Vercel
* Serverless hosting platform that builds the Next.js bundle and provisions AWS Lambda-based serverless functions for Python files located under `api/`.
* Dispatches requests matching `/api` directly to the compiled Python ASGI handler.

### Git / GitHub
* Version control system maintaining deployment history, feature branches (`clerk-billing-experiment`), and commit snapshots.

---

## 5. Authentication Flow

### How the Clerk JWT Reaches FastAPI
1. The frontend invokes `getToken()` from Clerk's `useAuth()` React hook.
2. Clerk checks the active browser session cookie, contacts Clerk's frontend API if needed, and returns an encoded RS256 JWT string.
3. The frontend passes this token in the standard HTTP header:
   ```http
   Authorization: Bearer <token>
   ```
4. Native browser `EventSource` does not support custom request headers. Hence, the frontend uses `@microsoft/fetch-event-source`, which supports passing standard HTTP headers during the initial SSE handshake.

### How FastAPI Validates the Token
Validation is performed by `fastapi_clerk_auth.ClerkHTTPBearer`:
1. **Header Parsing**: Extracts credentials from `Authorization: Bearer <token>`.
2. **Key Retrieval**: Inspects the JWT header for the Key ID (`kid`) and fetches the matching public RSA key from `CLERK_JWKS_URL` (`https://<clerk-domain>/.well-known/jwks.json`).
3. **Signature & Expiry Check**: Validates the cryptographic signature using the public key and checks that `exp` is in the future.
4. **Subject Extraction**: Decodes claims and populates `creds.decoded`, where `creds.decoded["sub"]` represents the unique Clerk User ID (`user_2...`).

### Why Backend Enforcement Is Mandatory
Client-side checks such as Next.js conditional rendering (`<SignedIn>`) can be easily bypassed by inspecting network calls or sending requests directly via `curl` or Postman.
* Backend authentication is the **only secure gatekeeper**.
* Every request hitting `/api` must prove its identity before the backend consumes costly third-party resources (such as the OpenAI API).

---

## 6. Billing / Authorization Flow

### Free vs. Premium Plan Design

| Dimension | Free Tier (`free_user`) | Premium Tier (`premium_subscription`) |
|---|---|---|
| **Price** | $0.00 / month | $10.00 / month ($8.00/mo annualized) |
| **Target Prompt** | Strict 400-word limit | Comprehensive, in-depth architectural response |
| **Access Gate** | Open to any authenticated user | Requires active paid subscription |
| **Clerk Slug** | `free_user` (`is_default: true`) | `premium_subscription` (`is_default: false`) |

### How Clerk Billing Identifies the User's Plan
In `api/index.py`, `get_user_subscription(user_id)` sends a server-to-server request:
```http
GET https://api.clerk.com/v1/users/{user_id}/billing/subscription
Authorization: Bearer CLERK_SECRET_KEY
User-Agent: IdeaGen/1.0
```
Clerk responds with the user's active billing profile:
```json
{
  "object": "commerce_subscription",
  "status": "active",
  "subscription_items": [
    {
      "status": "active",
      "plan": {
        "slug": "free_user",
        "is_default": true,
        "name": "Free"
      }
    }
  ]
}
```
The backend inspects `subscription_items`:
```python
subscription_items = subscription.get("subscription_items", [])
is_free_user = True

if subscription_items:
    plan = subscription_items[0].get("plan")
    if plan:
        is_free_user = plan.get("is_default", True) or (plan.get("slug") != "premium_subscription")
```

### Why Frontend-Only Protection Is Insufficient
* The frontend uses `<Protect plan="premium_subscription" fallback={<PricingTable />}>` in `pages/product.tsx` to alter UI visibility.
* However, an attacker can modify local JavaScript state or construct custom API payloads directly.
* If the backend did not independently query Clerk Billing, a malicious user could spoof a free token to trigger unlimited premium OpenAI generation.
* **Rule**: Frontend authorization controls the *experience*; backend authorization controls the *resource*.

---

## 7. Local Development vs. Production

### Command Responsibilities

| Command | Environment | Execution Target | Routing Behavior |
|---|---|---|---|
| `npm run dev` (`next dev`) | Local Node.js | Next.js development server on port 3000 | Only executes Node.js routes in `pages/`. **Does not run Python functions.** |
| `npm run build` (`next build`) | Build Stage | Next.js compiler & bundler | Compiles frontend assets and static HTML. Emits errors if TypeScript or routes are broken. |
| `vercel dev` | Local Emulation | Vercel local dev engine | Launches `next dev` for frontend **AND** builds/executes Python serverless functions in `api/`. |
| `vercel --prod` | Production Cloud | Vercel Edge & Serverless AWS Infrastructure | Builds production bundle and provisions cloud lambda functions. |

### Why `npm run dev` Did Not Reproduce Production
1. In production on Vercel, requests to `/api` are handled by serverless functions built from the root `api/` folder.
2. When developers run `npm run dev`, only the Next.js runtime executes. Next.js has no native knowledge of `api/index.py`.
3. Consequently, calling `/api` in standard `next dev` returned **404 Not Found**.
4. This discrepancy led someone to mistakenly create `pages/api/index.ts` to "fix" the 404 in `next dev`, which inadvertently broke the production architecture.

---

## 8. What Went Wrong: Timeline & Issues Encountered

```
+-----------------------------------------------------------------------------------------+
|                                    CHRONOLOGY OF DEFECTS                                |
|                                                                                         |
|  Day 2 Commit (33388b7)                                                                 |
|  * Simple Next.js + FastAPI backend deployed to Vercel production.                      |
|                                                                                         |
|  Day 3 Branch: clerk-billing-experiment (a978256)                                       |
|  * Clerk Auth and Billing added to frontend and api/index.py.                           |
|  * DEFECT 1: Typo "iimport os" on line 1 of api/index.py -> Fatal 500.                  |
|  * DEFECT 2: Missing imports for Request, urlopen, json -> Fatal 500.                   |
|  * DEFECT 3: Added pages/api/index.ts -> Shadows api/index.py, bypasses FastAPI.        |
|  * DEFECT 4: debug_mode=True in ClerkHTTPBearer -> Unhandled 500 on token decode.       |
|  * DEFECT 5: Cloudflare Error 1010 on urllib calls to Clerk -> 403 Forbidden.           |
|  * DEFECT 6: Assumed camelCase "subscriptionItems" in Clerk schema -> Broken billing.   |
|  * DEFECT 7: OPENAI_API_KEY missing in local .env.local -> 500 in local testing.        |
|  * DEFECT 8: macOS Python 3.14 vs uv Python 3.13 wheel mismatch in vercel dev.          |
+-----------------------------------------------------------------------------------------+
```

### Detailed Breakdown of Defects

1. **Duplicate `/api` Routes (`pages/api/index.ts` vs `api/index.py`)**:
   Next.js Pages Router treats `pages/api/` as an internal route table. When `pages/api/index.ts` was added, Next.js intercepted all `/api` traffic, routing it to a Node.js script and completely bypassing `api/index.py`.
2. **Python Syntax Error**:
   Line 1 of `api/index.py` contained `iimport os`. Python failed to parse the file on startup, returning an immediate 500.
3. **Missing Standard Library Imports**:
   `get_user_subscription` referenced `Request(...)`, `urlopen(...)`, and `json.loads(...)` without importing them, causing runtime `NameError` exceptions.
4. **Clerk `debug_mode=True` Unhandled Exceptions**:
   Setting `debug_mode=True` caused `fastapi-clerk-auth` to re-raise JWT parsing exceptions instead of returning clean HTTP 403 responses, turning authentication errors into 500 server crashes.
5. **Clerk API Cloudflare WAF Block (HTTP 403 Error 1010)**:
   Calling `api.clerk.com` via Python's default `urllib` user agent triggered Cloudflare's bot protection rule 1010, rejecting requests with HTTP 403.
6. **Billing Schema Mismatch (`subscriptionItems` vs `subscription_items`)**:
   The code assumed camelCase property names (`subscriptionItems`, `isDefault`), while Clerk's API returns snake_case (`subscription_items`, `is_default`). This caused `subscription.get("subscriptionItems", [])` to always evaluate to `[]`.
7. **Local Environment Variables**:
   `OPENAI_API_KEY` existed in the remote Vercel project but had not been pulled into `.env.local`, causing local standalone scripts to fail.
8. **Python Runtime ABI Mismatch on macOS**:
   In local development, the system `python3` in PATH was Python 3.14, whereas `uv` installed dependencies for Python 3.13. When Vercel dev ran, native extensions like `pydantic_core` failed to load (`ModuleNotFoundError: No module named 'pydantic_core._pydantic_core'`).

---

## 9. Root Cause Analysis

```
+------------------------------------------------------------------------------------------+
|                                    ROOT CAUSE MATRIX                                     |
+--------------------------+---------------------------------------------------------------+
| Category                 | Manifestations & Root Causes                                  |
+--------------------------+---------------------------------------------------------------+
| Architectural            | Route collision: pages/api/index.ts shadowed api/index.py.    |
|                          | Next.js Pages router intercepted requests meant for FastAPI.  |
+--------------------------+---------------------------------------------------------------+
| Coding Errors            | Typo 'iimport os' (SyntaxError).                              |
|                          | Missing imports: Request, urlopen, json (NameError).          |
|                          | debug_mode=True converting auth errors into 500s.             |
+--------------------------+---------------------------------------------------------------+
| External API Integration | Snake_case schema mismatch (subscription_items vs camelCase). |
|                          | Cloudflare WAF blocking default python-urllib User-Agent.     |
+--------------------------+---------------------------------------------------------------+
| Configuration / Env      | OPENAI_API_KEY missing from local .env.local.                 |
|                          | Python 3.14 vs 3.13 ABI mismatch in local developer toolchain.|
+--------------------------+---------------------------------------------------------------+
| Dev / Testing Toolchain  | Using npm run dev instead of vercel dev for multi-runtime.    |
+--------------------------+---------------------------------------------------------------+
```

---

## 10. Fixes Applied

| Component | What Changed | Why It Was Necessary | Problem It Solved |
|---|---|---|---|
| **Route Hierarchy** | Deleted `pages/api/index.ts` | Next.js Page routes override Vercel serverless function mappings. | Eliminated the shadow route so `/api` routes directly to `api/index.py`. |
| **Python Syntax** | Replaced `iimport os` with `import os` | Fixes invalid Python grammar on line 1. | Resolved syntax crash / startup 500 error. |
| **Module Imports** | Added `from urllib.request import Request, urlopen` and `import json` | `get_user_subscription` used these symbols without importing them. | Eliminated `NameError` crashes when calling the subscription helper. |
| **WAF Headers** | Added `"User-Agent": "IdeaGen/1.0"` to Clerk API calls | Cloudflare WAF blocks requests with Python's default user agent string. | Resolved Cloudflare 403 (Error 1010) when querying user subscriptions. |
| **Billing Parsing** | Updated dictionary access to `subscription.get("subscription_items", [])` and `plan.get("is_default", True)` | Clerk's REST API uses snake_case keys. | Fixed plan entitlement identification so paid users are properly recognized. |
| **Auth Guard Mode** | Set `debug_mode=False` on `ClerkHTTPBearer` | Debug mode re-raises exceptions rather than catching them and returning 403. | Prevented token decode failures from crashing FastAPI with 500 errors. |
| **Local Toolchain** | Configured `vercel dev` execution with Python 3.13 in `PATH` | Aligned runtime Python version with pre-compiled native `.so` wheels. | Resolved `ModuleNotFoundError: No module named 'pydantic_core._pydantic_core'`. |

---

## 11. Important Lessons for AI Engineering

1. **Verify External API Schemas Against Live Payloads**:
   Never guess external API response formats (camelCase vs snake_case). Always inspect raw API responses or consult official OpenAPI specs.
2. **Distinguish Frontend Routes from Backend Functions**:
   In hybrid frameworks like Next.js + FastAPI on Vercel, having both `pages/api/` and a root `api/` directory causes silent route shadowing. Keep backend endpoints exclusively in their designated runtime directory.
3. **Build Success $\neq$ Application Success**:
   `npm run build` only verifies that the TypeScript frontend compiles and static pages prerender. It does not execute Python backend code or validate external service integrations.
4. **Local Environments Diverge from Cloud Runtimes**:
   Running `npm run dev` runs Node.js, whereas Vercel production executes both Node.js and AWS Lambda Python containers. Use `vercel dev` to accurately emulate the multi-runtime production environment locally.
5. **Decouple Authentication from Authorization**:
   * *Authentication* answers: *"Who are you?"* (Clerk JWT validation).
   * *Authorization* answers: *"What are you entitled to do?"* (Clerk Billing subscription check).
   Keep these concerns distinct in both code and error reporting.
6. **Agentic Verification Over Generation**:
   AI coding assistants should not merely emit code and claim victory. They must execute tests (AST analysis, compilation, curl requests, SSE stream consumption) to verify that modifications function end-to-end.
7. **Human Architectural Review Is Indispensable**:
   While automated tools can diagnose stack traces and syntax bugs, human guidance ensures that architectural constraints (e.g. keeping `gpt-5-nano`, preserving FastAPI, avoiding premature rewrites) are strictly honored.

---

## 12. Agentic / Loop Engineering

This project utilized the **Antigravity agentic engineering loop**:

```
[Inspect]  --> Inspect repo, git diffs, build outputs, environment keys
   |
   v
[Hypothesize] -> Trace 403, 404, 500 errors to syntax, shadow routes, WAF rules
   |
   v
[Plan]     --> Generate implementation_plan.md with verified API data
   |
   v
[Approve]  --> Developer review and constraint alignment (e.g., keep gpt-5-nano)
   |
   v
[Modify]   --> Apply atomic edits to api/index.py, remove pages/api/index.ts
   |
   v
[Test]     --> Execute vercel dev, test curl with real Clerk session JWT
   |
   v
[Observe]  --> Observe 589 SSE chunks and 200 OK stream response
   |
   v
[Verify]   --> Update walkthrough.md and confirm zero lingering regressions
```

### Division of Responsibility
* **Delegated to Agent**: Log inspection, dependency resolution, syntax and AST validation, API schema querying, automated curl test execution, and documentation generation.
* **Retained by Developer**: Core architectural boundaries, business model selection, budget and deployment approval, and model retention decisions.

---

## 13. Git Branching Strategy

```
  main (commit 33388b7) ---------------------------------------------------+
       \                                                                   | Future Merge
        \ (branch)                                                         | (After billing test
         v                                                                 |  & user verification)
  clerk-billing-experiment (commit a978256 -> uncommitted fixes) --------->+
```

### Branch Roles
* **`main`**: The stable production branch representing Day 2 deployment (`33388b7`).
* **`clerk-billing-experiment`**: An isolated experiment branch created to implement Clerk Authentication and Billing without risking the stable baseline.
* **Why Isolate?**: Integrating third-party authentication and billing touches routing, dependencies, environment configs, and API handlers simultaneously. Isolating this work prevented broken intermediate states from disrupting production deployments.
* **Merging Criteria**: The experiment branch should be merged back into `main` only after:
  1. Local end-to-end tests confirm authentication and streaming stability.
  2. Free vs. Premium checkout and plan upgrades are verified in Clerk's test environment.
  3. Team completes final code review.

---

## 14. Current Project State

* **Working and Verified**:
  * Clean production Next.js build (`npm run build`).
  * Full app orchestration under `vercel dev` on port 3000.
  * Next.js pages `/` and `/product` render correctly.
  * Route `/api` routes directly to `api/index.py`.
  * Unauthenticated and invalid token requests cleanly rejected with HTTP 403 `{"detail":"Forbidden"}`.
  * Valid Clerk session JWTs verified against `CLERK_JWKS_URL`.
  * User subscription retrieved from Clerk API without Cloudflare WAF blocks.
  * Real-time streaming from OpenAI using model `gpt-5-nano` via Server-Sent Events (589 chunks, 3,141 characters).
  * **Production Deployment Verified**: Successfully deployed to Vercel production (`https://saas-five-blue-38.vercel.app`). Live endpoints verified for Next.js frontend rendering, unauthenticated 403 FastAPI rejection, and authenticated Clerk JWT SSE streaming.
* **Remains to Be Tested**:
  * Live end-to-end checkout flow using a test credit card on Clerk's hosted Stripe portal to verify automatic real-time entitlement transitions from Free to Premium.
* **Deployment Status**:
  * **Deployed to production** on Vercel at `https://saas-five-blue-38.vercel.app`.
* **Known Limitations**:
  * Local developer environment must use Python 3.13 in `PATH` when executing `vercel dev` to match pre-compiled native extension wheels.

---

## 15. Useful Commands Reference

| Command | Purpose / Description | Context |
|---|---|---|
| `npm run dev` | Starts Next.js local development server (port 3000) | Fast UI development; **does not execute Python backend** |
| `npm run build` | Compiles Next.js frontend and checks TypeScript / ESLint | Pre-deployment verification |
| `vercel dev` | Emulates full Vercel environment (Next.js + Python functions) | **Required for end-to-end local testing** |
| `vercel dev --listen 3000` | Binds local Vercel dev server explicitly to port 3000 | Custom port binding |
| `vercel env ls` | Lists all remote environment variables for the linked project | Checking configured cloud secrets |
| `vercel env pull .env.local` | Pulls remote development environment variables into local file | Syncing API keys locally |
| `vercel --prod` | Deploys current working directory to Vercel production | Production deployment (use with caution) |
| `git status` | Displays working tree status and modified / untracked files | Checking workspace cleanliness |
| `git diff` | Shows line-by-line code modifications | Code review before committing |
| `git switch <branch>` | Switches active working branch | Context switching between features |
| `git merge <branch>` | Merges specified branch into current active branch | Integrating verified features |

---

## 16. Glossary

* **API (Application Programming Interface)**: A set of defined rules and protocols allowing different software components to communicate.
* **Endpoint**: A specific URL location on a server (e.g. `/api`) where an API accepts incoming client requests.
* **Serverless Function**: A stateless compute container executed on demand by a cloud provider in response to events or HTTP requests, scaling automatically to zero when idle.
* **JWT (JSON Web Token)**: A compact, URL-safe standard (RFC 7519) for transmitting cryptographically signed claims between parties.
* **JWKS (JSON Web Key Set)**: A set of public cryptographic keys published at a well-known URL used to verify signatures on JWTs issued by an identity provider.
* **Authentication (AuthN)**: The process of verifying *who* a user is (e.g. valid login with Clerk).
* **Authorization (AuthZ)**: The process of verifying *what* a user is permitted to do (e.g. checking if a user has a Premium plan).
* **Server-Sent Events (SSE)**: A standardized HTTP protocol allowing a server to push real-time text data stream updates to a browser over an open connection.
* **SaaS (Software-as-a-Service)**: A software distribution model where applications are hosted centrally in the cloud and licensed on a subscription basis.
* **WAF (Web Application Firewall)**: A security proxy that monitors and filters HTTP traffic to protect web services from malicious bots, scrapers, and attacks.
* **C-Extension / ABI (Application Binary Interface)**: Compiled machine code libraries (such as Rust- or C-based Python extensions like `pydantic_core`) that require exact version matching with the host Python interpreter.
* **Branch**: An isolated line of development in Git permitting developers to test changes without impacting production code.
* **Merge**: Integrating changes from one Git branch into another.
