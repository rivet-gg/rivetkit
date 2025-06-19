import asyncio
from rivetkit_client import AsyncClient as ActorClient
import prompt_toolkit
from prompt_toolkit.patch_stdout import patch_stdout
from typing import TypedDict, List

async def init_prompt() -> tuple[str, str]:
    username = await prompt_toolkit.prompt_async("Username: ")
    room = await prompt_toolkit.prompt_async("Room: ")
    return username, room

async def main():
    # Get username and room
    username, room = await init_prompt()
    print(f"Joining room '{room}' as '{username}'")

    # Create client and connect to chat room
    client = ActorClient("http://localhost:6420")
    chat_room = await client.get("chatRoom", tags={"room": room}, params={"room": room})

    # Get and display history
    history = await chat_room.action("getHistory", [])
    if history:
        print("\nHistory:")
        for msg in history:
            print(f"[{msg['username']}] {msg['message']}")

    # Set up message handler
    def on_message(username: str, message: str):
        print(f"\n[{username}] {message}")

    chat_room.on_event("newMessage", on_message)

    # Main message loop
    print("\nStart typing messages (press Ctrl+D or send empty message to exit)")
    try:
        with patch_stdout():
            while True:
                # NOTE: Using prompt_toolkit to keep messages
                # intact, regardless of other threads / tasks.
                message = await prompt_toolkit.prompt_async("\nMessage: ")
                if not message:
                    break
                await chat_room.action("sendMessage", [username, message])
    except EOFError:
        pass
    finally:
        print("\nDisconnecting...")
        await chat_room.disconnect()

if __name__ == "__main__":
    asyncio.run(main()) 
