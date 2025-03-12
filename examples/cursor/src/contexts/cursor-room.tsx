import { useActor } from "@actor-core/react";
import type { App } from "../index";
import { createContext, useContext } from "react";

type CursorRoomContextType = ReturnType<typeof useActor<App["config"]["actors"]["cursor-room"]>>;

const CursorRoomContext = createContext<CursorRoomContextType | null>(null);

export function useCursorRoom() {
  const context = useContext(CursorRoomContext);
  if (!context) {
    throw new Error("useCursorRoom must be used within a CursorRoomProvider");
  }
  return context;
}

export const CursorRoomProvider = CursorRoomContext.Provider; 