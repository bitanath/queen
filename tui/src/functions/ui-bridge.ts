//TODO agents might actually refresh the actual dashboard with gated/filtered data... whodathunkit
import type { DocumentKind } from "../documents";
import type { AnswerView } from "../utils/answer-view";

export type DocFilter = {
  kinds?: DocumentKind[];
  from?: number;
  to?: number;
  query?: string;
  limit?: number;
};

export type ToastVariant = "success" | "error" | "info";

export type UiBridge = {
  showDocuments(filter?: DocFilter): void;
  refreshDocuments(): void;
  openAnswer(view: AnswerView): void;
  toast(message: string, variant?: ToastVariant): void;
  login(): void;
  /** Ask the user one question (quick-select) and resolve with their choice. */
  clarify(question: string, options: string[]): Promise<string>;
};
