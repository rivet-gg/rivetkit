import asyncio
import os
from actor_core_client import AsyncClient as ActorClient

async def main():
    # Create client
    endpoint = os.getenv("ENDPOINT", "http://localhost:6420")
    client = ActorClient(endpoint)

    # Connect to chat room
    chat_room = await client.get("chatRoom")

    # Get existing messages
    messages = await chat_room.action("getHistory", [])
    print("Messages:", messages)

    # Listen for new messages
    def on_message(username: str, message: str):
        print(f"Message from {username}: {message}")

    chat_room.on_event("newMessage", on_message)

    # Send message to room
    await chat_room.action("sendMessage", ["william", "All the world's a stage."])

    # Disconnect from actor when finished
    await chat_room.disconnect()

if __name__ == "__main__":
    asyncio.run(main()) 