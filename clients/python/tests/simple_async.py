import asyncio
from python_actor_core_client import AsyncSimpleClient as ActorClient

async def main():
    client = ActorClient("http://127.0.0.1:6420")

    handle = await client.get("counter")
    print("Actor handle:", handle)

    print("Subscribing to newCount")
    await handle.subscribe("newCount")

    print("Receiving msgs")
    print(await handle.receive(1))

    print("Sending action")
    print(await handle.action("increment", 1))


asyncio.run(main())