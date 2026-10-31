import anthropic
import os

api_key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("CLAUDE_API_KEY")
model = os.environ.get("ANTHROPIC_MODEL")
if not api_key or not model:
    raise SystemExit("Set ANTHROPIC_API_KEY and ANTHROPIC_MODEL before running this example.")
client = anthropic.Anthropic(api_key=api_key)

message = client.messages.create(
    model=model,
    max_tokens=1000,
    messages=[
        {
            "role": "user",
            "content": "What should I search for to find the latest developments in renewable energy?",
        }
    ],
)

for block in message.content:
    if block.type == "text":
        print(block.text)
