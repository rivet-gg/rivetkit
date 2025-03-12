import { setup } from "actor-core";
import { CursorRoom } from "./cursor-room";

export const app = setup({
  actors: {
    "cursor-room": CursorRoom,
  },
  cors: {
    origin: ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002"],
    credentials: true
  },
  manager: {
    enabled: true
  },
  ws: {
    enabled: true
  }
});

export type App = typeof app; 