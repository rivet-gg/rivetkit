## Routing

## P2P

## Actor Loading

- Manager.create to create actor
- ActorDriver.loadActor to load actor in to memory
    - ActorDefinition.instantiate to create `ActorInstance` class
    - ActorInstance.start to start it

## Actor Lifecycle & Sleeping

- FS
    - Actors do not go to sleep
- DO
    - Up to Cloudflare
- Redis
    - P2P -- goes to sleep when no requests are currently using the actor

## Main symbols

- RunConfig
- Registry & RegistryConfig
- Client & inline client
- ManagerDriver
- ActorDriver
- GenericConnGlobalState & other generic drivers: tracks actual connections separately from the actual conn state
    - TODO: Can we remove the "generic" prefix?

