import type { Environment } from "@/environment";

// MARK: - elthur engine 
export type EngineMessage = { role: string; content: string };

export type StreamResult = { text: string; truncated: boolean; maxTokens: number };

export interface GenerateOptions {
  prompt: string;
  system?: string;
  maxTokens?: number;
}

export interface StreamOptions {
  prompt: string;
  system?: string;
  maxTokens?: number;
  onChunk: (textSoFar: string) => void;
  isCancelled?: () => boolean;
}

export interface FallbackOptions {
  attempted: string;
  detail: string;
  onChunk: (textSoFar: string) => void;
  isCancelled?: () => boolean;
}

export interface BeginStreamOptions {
  messages: EngineMessage[];
  system: string;
  toolsJson?: string | null;
  maxTokens: number;
}

export interface SearchBeeOptions {
  query: string;
  limit?: number;
  env?: Environment;
}

export interface LoginOptions {
  token: string;
  env?: Environment;
}

export interface PairingOptions {
  env?: Environment;
  withQr?: boolean;
}

export interface PollPairingOptions {
  env?: Environment;
  isCancelled?: () => boolean;
}
