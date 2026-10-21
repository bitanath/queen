/* @jsxImportSource @opentui/react */
import type { Tool } from "@strands-agents/sdk";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { beeToolsFor, getBeeMcpState, startBeeMcp, stopBeeMcp, subscribeBeeMcp, type BeeMcpState, } from "./libraries/bee-mcp";

export type McpContextValue = BeeMcpState & {
  ready: boolean;
  beeToolsFor: (names: readonly string[]) => Tool[];
};

const McpContext = createContext<McpContextValue>({
  status: "stopped",
  toolCount: 0,
  error: null,
  ready: false,
  beeToolsFor: () => [],
});

export function useMcp(): McpContextValue {
  return useContext(McpContext);
}

export function McpProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BeeMcpState>(getBeeMcpState);

  useEffect(() => {
    const unsubscribe = subscribeBeeMcp(() => setState(getBeeMcpState()));
    void startBeeMcp();
    setState(getBeeMcpState());
    return () => {
      unsubscribe();
      void stopBeeMcp();
    };
  }, []);

  const value: McpContextValue = { ...state, ready: state.status === "connected", beeToolsFor };
  return <McpContext.Provider value={value}>{children}</McpContext.Provider>;
}
