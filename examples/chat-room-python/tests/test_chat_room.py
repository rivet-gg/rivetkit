import pytest
from actor_core_client import AsyncClient as ActorClient
from actor_core_test import setup_test
from typing import TypedDict, List


async def test_chat_room_should_handle_messages():
    # Set up test environment
    client = await setup_test()

    # Connect to chat room
    chat_room = await client.get("chatRoom")

    # Initial history should be empty
    initial_messages = await chat_room.action("getHistory", [])
    assert initial_messages == []

    # Test event emission
    received_data = {"username": "", "message": ""}

    def on_message(username: str, message: str):
        received_data["username"] = username
        received_data["message"] = message

    chat_room.on_event("newMessage", on_message)

    # Send a message
    test_user = "william"
    test_message = "All the world's a stage."
    await chat_room.action("sendMessage", [test_user, test_message])

    # Verify event was emitted with correct data
    assert received_data["username"] == test_user
    assert received_data["message"] == test_message

    # Verify message was stored in history
    updated_messages = await chat_room.action("getHistory", [])
    assert updated_messages == [{"username": test_user, "message": test_message}]

    # Send multiple messages and verify
    users = ["romeo", "juliet", "othello"]
    messages = [
        "Wherefore art thou?",
        "Here I am!",
        "The green-eyed monster."
    ]

    for i in range(len(users)):
        await chat_room.action("sendMessage", [users[i], messages[i]])

        # Verify event emission
        assert received_data["username"] == users[i]
        assert received_data["message"] == messages[i]

    # Verify all messages are in history in correct order
    final_history = await chat_room.action("getHistory", [])
    expected_history = [{"username": test_user, "message": test_message}]
    expected_history.extend([
        {"username": users[i], "message": messages[i]}
        for i in range(len(users))
    ])

    assert final_history == expected_history

    # Cleanup
    await chat_room.disconnect() 