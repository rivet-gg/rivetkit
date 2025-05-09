from python_actor_core_client import Client as ActorClient

client = ActorClient("http://127.0.0.1:6420")

handle = client.get("counter")
print("Actor handle:", handle)

print("Subscribing to newCount")
handle.on_event("newCount", lambda msg: print("Received msg:", msg))

print("Sending action")
print(handle.action("increment", 1))
