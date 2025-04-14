from python_actor_core_client import SimpleClient as ActorClient

client = ActorClient("http://127.0.0.1:6420")

handle = client.get("counter")
print("Actor handle:", handle)

print("Subscribing to newCount")
handle.subscribe("newCount")

print("Receiving msgs")
print(handle.receive(1))

print("Sending action")
print(handle.action("increment", 1))
