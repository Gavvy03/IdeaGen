iimport os

from fastapi import FastAPI, Depends
from fastapi.responses import StreamingResponse
from fastapi_clerk_auth import (
    ClerkConfig,
    ClerkHTTPBearer,
    HTTPAuthorizationCredentials
)
from openai import OpenAI

app = FastAPI()

clerk_config = ClerkConfig(
    jwks_url=os.getenv("CLERK_JWKS_URL")
)

clerk_guard = ClerkHTTPBearer(
    clerk_config,
    debug_mode=True
)


def get_user_subscription(user_id: str):
    """Get the user's current Clerk Billing subscription."""

    clerk_secret_key = os.getenv("CLERK_SECRET_KEY")

    url = f"https://api.clerk.com/v1/users/{user_id}/billing/subscription"

    request = Request(
        url,
        headers={
            "Authorization": f"Bearer {clerk_secret_key}",
        },
    )

    with urlopen(request) as response:
        return json.loads(response.read().decode("utf-8"))


@app.get("/api")
def idea(creds: HTTPAuthorizationCredentials = Depends(clerk_guard)):

    # Identify the signed-in user
    user_id = creds.decoded["sub"]

    # Get the user's subscription from Clerk
    subscription = get_user_subscription(user_id)

    # Clerk automatically gives every new user the default/free plan.
    # A paid user will have a different plan.
    subscription_items = subscription.get("subscriptionItems", [])

    is_free_user = True

    if subscription_items:
        plan = subscription_items[0].get("plan")

        if plan:
            is_free_user = plan.get("isDefault", False)

    # Set the appropriate instruction based on the user's plan
    if is_free_user:
        prompt_text = """
        Reply with a new business idea for AI Agents in English.

        Keep the response to a maximum of 400 words.

        Format the response with headings, sub-headings and bullet points.
        Make the idea practical, specific and useful.
        """
    else:
        prompt_text = """
        Reply with a new business idea for AI Agents in English.

        Provide a detailed and comprehensive response.

        Format the response with headings, sub-headings and bullet points.
        Make the idea practical, specific and useful.
        """

    client = OpenAI()

    prompt = [
        {
            "role": "user",
            "content": prompt_text
        }
    ]

    stream = client.chat.completions.create(
        model="gpt-5-nano",
        messages=prompt,
        stream=True
    )

    def event_stream():
        for chunk in stream:
            text = chunk.choices[0].delta.content

            if text:
                lines = text.split("\n")

                for line in lines[:-1]:
                    yield f"data: {line}\n\n"
                    yield "data:  \n"

                yield f"data: {lines[-1]}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream"
    )