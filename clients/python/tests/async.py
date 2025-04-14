import asyncio
from python_actor_core_client import AsyncClient as ActorClient

async def main():
    client = ActorClient("http://127.0.0.1:6420")

    handle = await client.get("counter", tags={"tag":"valu3"})
    print("Actor handle:", handle)

    print("Subscribed to newCount")
    handle.on_event("newCount", lambda msg: print("Received msg:", msg))

    print("Sending action")
    print(await handle.action("increment", 1))

    await asyncio.sleep(2)


asyncio.run(main())