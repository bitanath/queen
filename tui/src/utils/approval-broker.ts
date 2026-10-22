import type { ToolRisk } from "../functions/tool-definitions";

export type ApprovalRequest = {
  id: number;
  name: string;
  description?: string;
  args?: Record<string, unknown>;
  risk: ToolRisk;
};

type ApprovalHandler = (req: ApprovalRequest) => Promise<boolean>;

let handler: ApprovalHandler | null = null;
const alwaysAllow = new Set<string>();

export function setApprovalHandler(next: ApprovalHandler | null): void {
  handler = next;
}

export function isAlwaysAllowed(name: string): boolean {
  return alwaysAllow.has(name);
}

export function allowAlways(name: string): void {
  alwaysAllow.add(name);
}

export async function requestApproval(req: Omit<ApprovalRequest, "id">): Promise<boolean> {
  if (alwaysAllow.has(req.name)) return true;
  if (!handler) return false;
  return handler({ ...req, id: Date.now() });
} //FIXME Request human approval for shell actions
