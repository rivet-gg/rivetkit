import type { AnyActorInstance } from "./instance";
import type { Connection } from "./connection";
import type { Logger } from "@/common/log";
import type { ActorTags } from "@/common/utils";
import type { Schedule } from "./schedule";
import type { ConnectionId } from "./connection";
import type { SaveStateOptions } from "./instance";
import { Rpcs } from "./config";
import { ActorContext } from "./context";

/**
 * Context for a remote procedure call.
 *
 * @typeParam A Actor this RPC belongs to
 * @see {@link https://rivet.gg/docs/rpc|RPC Documentation}
 */
export class RpcContext<S, CP, CS> {
  #actorContext: ActorContext<S, CP, CS>;
  
  /**
   * Should not be called directly.
   *
   * @param actorContext - The actor context
   * @param connection - The connection associated with the RPC.
   */
  constructor(
    actorContext: ActorContext<S, CP, CS>,
    public readonly connection: Connection<S, CP, CS>
  ) {
    this.#actorContext = actorContext;
  }
  
  /**
   * Get the actor state
   */
  get state(): any {
    return this.#actorContext.state;
  }
  
  /**
   * Broadcasts an event to all connected clients.
   */
  broadcast(name: string, ...args: any[]): void {
    this.#actorContext.broadcast(name, ...args);
  }
  
  /**
   * Gets the logger instance.
   */
  get log(): Logger {
    return this.#actorContext.log;
  }
  
  /**
   * Gets the actor tags.
   */
  get tags(): ActorTags {
    return this.#actorContext.tags;
  }
  
  /**
   * Gets the region.
   */
  get region(): string {
    return this.#actorContext.region;
  }
  
  /**
   * Gets the scheduler.
   */
  get schedule(): Schedule {
    return this.#actorContext.schedule;
  }
  
  /**
   * Gets the map of connections.
   */
  get connections(): Map<ConnectionId, Connection<S, CP, CS>> {
    return this.#actorContext.connections;
  }
  
  /**
   * Forces the state to get saved.
   */
  async saveState(opts: SaveStateOptions): Promise<void> {
    return this.#actorContext.saveState(opts);
  }
  
  /**
   * Runs a promise in the background.
   */
  runInBackground(promise: Promise<void>): void {
    return this.#actorContext.runInBackground(promise);
  }
}
