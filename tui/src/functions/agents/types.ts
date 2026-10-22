export type AgentName = "bee_read" | "bee_list" | "bee_write" | "os_action";
export type DecisionAgent = AgentName | "done";

export type AgentStatus = {
  phase: "ask" | "orchestrator" | "select" | "agent" | "approval" | "done";
  agent?: DecisionAgent;
  family?: string;
  tools?: string[];
  detail?: string;
};

export type StatusListener = (status: AgentStatus) => void;

export type SessionItem = {
  id: string | number;
  title: string;
  index: number;
  kind?: string;
  createdAt?: number;
  record?: Record<string, unknown>;
};

export type SessionResult = {
  kind: string;
  items: SessionItem[];
  text?: string;
};

export type SessionAction = {
  tool: string;
  args: Record<string, unknown>;
};

export type PendingClarification = {
  prompt: string;
  options?: string[];
  original: string;
};

export type SessionState = {
  activeDoc?: {
    kind: string;
    id: string | number;
    title?: string;
    summary?: string;
  };
  lastResult?: SessionResult;
  lastEntity?: SessionItem;
  lastAction?: SessionAction;
  pendingClarification?: PendingClarification;
};

export type RouteDecision = {
  prompt: string;
  agent: DecisionAgent;
  clarify: boolean;
  final?: boolean;
};

export type NeedsInput = {
  question: string;
  options?: string[];
};

export type Unsupported = {
  reason: string;
  suggestion: string;
};

export type StepResult = {
  agent: AgentName;
  prompt: string;
  family: string;
  tools: string[];
  text: string;
  needsInput?: NeedsInput;
  unsupported?: Unsupported;
  approval?: {
    tool: string;
    args: Record<string, unknown>;
  };
};

export type TurnResult = {
  text: string;
  ack: string;
  session: SessionState;
  steps: StepResult[];
  clarification?: string;
  approval?: {
    tool: string;
    args: Record<string, unknown>;
  };
  unsupported?: Unsupported;
};

export type ToolRunEvent = {
  kind: "start" | "end";
  info: {
    id: string;
    name: string;
    args?: Record<string, unknown>;
    status: "running" | "success" | "error";
    result?: string;
    error?: string;
    durationMs?: number;
  };
};

export type TurnCallbacks = {
  onAck?: (text: string) => void;
  onText?: (text: string) => void;
  onThinking?: (text: string) => void;
  onStatus?: StatusListener;
  onTool?: (event: ToolRunEvent) => void;
  onMeta?: (meta: Record<string, number>) => void;
  isCancelled?: () => boolean;
};
