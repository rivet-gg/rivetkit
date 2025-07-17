
Manager router -> ManagerDriver.createActor -> save actor in memory
Manager router -> ManagerDriver.proxyRequest -> actorRouter.fetch(req, { Bindings: ... }) -> get actor ID from env -> ActorDriver.loadActor -> call actor action

## todo

[ ] fix genericconnectionglobalstate

