# IdeaGen

IdeaGen is an AI-powered SaaS application that generates new business ideas using OpenAI.

The project is being built as a hands-on **AI Engineering and Production Engineering learning project**, with a focus on taking an AI application from development to production while learning the engineering practices required along the way.

## What We're Building

IdeaGen is a simple SaaS application where users can:

- Generate AI-powered business ideas
- Receive AI responses in real time through streaming
- Sign in securely using Clerk
- Use the application under a Free plan
- Upgrade to a Premium plan for more comprehensive responses

## Technology

- **Frontend:** Next.js + TypeScript
- **Backend:** FastAPI + Python
- **AI:** OpenAI API
- **Authentication & Billing:** Clerk
- **Deployment:** Vercel

## High-Level Architecture

```text
User
 │
 ▼
Next.js Frontend
 │
 ▼
FastAPI Backend
 │
 ├── Clerk Authentication
 ├── Clerk Billing
 └── OpenAI
       │
       ▼
   Streaming Response
       │
       ▼
Next.js UI


Project Status

The core application is deployed to Vercel and the end-to-end production flow has been verified, including:

Clerk authentication
Billing-plan detection
OpenAI generation
Real-time streaming responses
Learning Journey

This project is part of a hands-on journey into AI Engineering and production deployment.

The goal is not just to build an AI application, but to understand how the different components work together in a production SaaS system.

Project Documentation

For a detailed explanation of the architecture, implementation decisions, debugging journey, problems encountered, fixes applied, and lessons learned:
[Read the Project Overview](docs/project-overview.md)
