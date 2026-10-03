// Bee, in-process. Deep imports into vendored bee-cli sources — no `bee`
// binary, no subprocess. Every function returns data (markdown strings for
// chat bubbles); NOTHING prints. Logged-out calls throw NotLoggedIn so the
// chat layer can decide the engine fallback. Mirrors the CLI's behavior,
// endpoints, and wording (sources/commands/*) 1:1.

import type { CommandContext } from "@/commands/types";
import { createDeveloperClient } from "@/client";
import { requestClientJson } from "@/client/clientApi";
import { fetchClientMe } from "@/client/clientMe";
import { createCommandContext } from "@/context";
import { callBeeTextTool } from "@/commands/mcpToolOutput";
import { getEnvironmentConfig, type Environment } from "@/environment";
import { todayResource } from "@/resources/today";
import {
  clearPairingState,
  clearProxyConfig,
  clearToken,
  loadPairingState,
  loadToken,
  savePairingState,
  saveToken,
} from "@/secureStore";
import { requestAppPairing } from "@/commands/auth/appPairingRequest";
import {
  decryptAppPairingToken,
  generateAppPairingKeyPair,
} from "@/utils/appPairingCrypto";
import { renderQrCode } from "@/utils/qrCode";
import {
  formatRecordMarkdown,
  resolveTimeZone,
} from "@/utils/markdown";

const BEE_CLI_SHA = process.env.QUEEN_BEE_SHA ?? "dev"; //NOTE Pinned bee-cli submodule (`git -C bee-cli rev-parse HEAD`); "dev" when run unbundled.

export class NotLoggedIn extends Error {
  constructor() {
    super('Not logged in. Run /login first.');
    this.name = "NotLoggedIn";
  }
}

export function isNotLoggedIn(err: unknown): boolean {
  return (
    err instanceof NotLoggedIn ||
    (err instanceof Error && /not logged in/i.test(err.message))
  );
}

let cached: { env: Environment; ctx: CommandContext } | null = null;

export async function beeContext(env: Environment = "prod"): Promise<CommandContext> {
  if (!cached || cached.env !== env) {
    cached = { env, ctx: await createCommandContext(env) };
  }
  return cached.ctx;
}

export function dropBeeContext(): void {
  cached = null;
}

export type StatusInfo = {
  apiLabel: string;
  apiUrl: string;
  connected: boolean;
  tokenMask: string | null;
  verifiedName: string | null;
  verifiedId: number | null;
  viaProxy: string | null;
  beeCliSha: string;
};

export async function getStatus(env: Environment = "prod"): Promise<StatusInfo> {
  const ctx = await beeContext(env);
  const config = getEnvironmentConfig(env);
  const proxyAddress = ctx.client.isProxy ? ctx.client.proxyAddress : undefined;

  if (proxyAddress) {
    const user = await fetchClientMe(ctx);
    return {
      apiLabel: config.label,
      apiUrl: config.apiUrl,
      connected: true,
      tokenMask: null,
      verifiedName: [user.first_name, user.last_name].filter(Boolean).join(" "),
      verifiedId: user.id,
      viaProxy: proxyAddress,
      beeCliSha: BEE_CLI_SHA,
    };
  }

  const token = await loadToken(env);
  if (!token) throw new NotLoggedIn();

  const user = await fetchClientMe(ctx, token);
  return {
    apiLabel: config.label,
    apiUrl: config.apiUrl,
    connected: true,
    tokenMask: maskToken(token),
    verifiedName: [user.first_name, user.last_name].filter(Boolean).join(" "),
    verifiedId: user.id,
    viaProxy: null,
    beeCliSha: BEE_CLI_SHA,
  };
}

export function renderStatusMd(s: StatusInfo): string {
  const lines = [`API: ${s.apiLabel} (${s.apiUrl})`, `bee-cli: ${s.beeCliSha.slice(0, 12)}`];
  if (s.viaProxy) lines.push(`Connected via proxy: ${s.viaProxy}`);
  if (s.tokenMask) lines.push(`Token: ${s.tokenMask}`);
  if (s.verifiedName) lines.push(`Verified as ${s.verifiedName} (id ${s.verifiedId}).`);
  return lines.join("\n");
}

function maskToken(token: string): string {
  const t = token.trim();
  return t.length <= 8 ? "********" : `${t.slice(0, 4)}...${t.slice(-4)}`;
}

export async function getMe(env: Environment = "prod"): Promise<string> {
  const ctx = await beeContext(env);
  const data = await requestClientJson(ctx, "/v1/me", { method: "GET" });
  return formatRecordMarkdown({
    title: "Profile",
    record: parseProfile(data),
    timeZone: resolveTimeZone(parseTimezone(data)),
    nowMs: Date.now(),
  });
}

function parseTimezone(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const tz = (value as { timezone?: unknown }).timezone;
  return typeof tz === "string" ? tz : null;
}

function parseProfile(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    return { first_name: "n/a", last_name: "n/a" };
  }
  const r = payload as { first_name?: unknown; last_name?: unknown; timezone?: unknown };
  return {
    first_name: typeof r.first_name === "string" ? r.first_name : "n/a",
    last_name: typeof r.last_name === "string" ? r.last_name : "n/a",
    timezone: typeof r.timezone === "string" ? r.timezone : "n/a",
  };
}

export async function searchBee(
  query: string,
  limit = 5,
  env: Environment = "prod",
): Promise<string> {
  const ctx = await beeContext(env);
  const data = await callBeeTextTool(ctx, "bee_search", { query, limit });
  return toolDataMd("Bee Search", data);
}

function toolDataMd(title: string, data: unknown): string {
  const record =
    data && typeof data === "object" ? (data as Record<string, unknown>) : { value: data };
  const tz = typeof record["timezone"] === "string" ? record["timezone"] : null;
  return formatRecordMarkdown({ title, record, timeZone: resolveTimeZone(tz), nowMs: Date.now() });
}

export async function getTodayBrief(env: Environment = "prod"): Promise<string> {
  const ctx = await beeContext(env);
  const briefAction = todayResource.actions[1];
  if (!briefAction) throw new Error("today resource missing brief action");
  const result = await briefAction.run(ctx, { context: false });
  if (result.kind !== "json") throw new Error("unexpected today result");
  const record =
    result.data && typeof result.data === "object"
      ? (result.data as Record<string, unknown>)
      : { value: result.data };
  return formatRecordMarkdown({
    title: "Today Brief",
    record,
    timeZone: resolveTimeZone(parseTimezone(result.data)),
    nowMs: Date.now(),
  });
}

export async function getTodayContext(env: Environment = "prod"): Promise<string> {
  const ctx = await beeContext(env);
  const data = await callBeeTextTool(ctx, "bee_get_today", {});
  return toolDataMd("Today", data);
}

export async function loginWithToken(token: string, env: Environment = "prod"): Promise<string> {
  const clean = token.trim();
  if (!clean) throw new Error("Missing token.");
  const ctx = await beeContext(env);
  const apiCtx: CommandContext = { ...ctx, client: createDeveloperClient(env) };
  const user = await fetchClientMe(apiCtx, clean);
  await saveToken(env, clean);
  return [user.first_name, user.last_name].filter(Boolean).join(" ");
}

export type PairingStart = {
  pairingUrl: string;
  expiresAt: string;
  resumed: boolean;
  qr: string | null;
};

function defaultAppId(env: Environment): string {
  return env === "staging" ? "pk5z3uuzjpxj4f7frk6rsq2f" : "ph9fssu1kv1b0hns69fxf7rx";
}

export async function startPairing(
  env: Environment = "prod",
  withQr = false,
): Promise<PairingStart> {
  const existing = await loadPairingState(env);
  if (existing) {
    const exp = Date.parse(existing.expiresAt);
    if (!Number.isNaN(exp) && Date.now() < exp) {
      return {
        pairingUrl: existing.pairingUrl,
        expiresAt: existing.expiresAt,
        resumed: true,
        qr: withQr ? await renderQrCode(existing.pairingUrl) : null,
      };
    }
    await clearPairingState(env);
  }

  const appId = defaultAppId(env);
  const keyPair = generateAppPairingKeyPair();
  const initial = await requestAppPairing(env, appId, keyPair.publicKeyBase64);
  if (initial.status === "completed") {
    const token = decryptAppPairingToken(initial.encryptedToken, keyPair.secretKey);
    await saveToken(env, token);
    throw new Error("ALREADY_PAIRED");
  }
  if (initial.status === "expired") {
    throw new Error("Pairing request expired. Please try again.");
  }
  const pairingUrl = `https://bee.computer/connect#${initial.requestId}`;
  await savePairingState(env, {
    appId,
    publicKey: keyPair.publicKeyBase64,
    secretKey: Buffer.from(keyPair.secretKey).toString("base64"),
    requestId: initial.requestId,
    pairingUrl,
    expiresAt: initial.expiresAt,
  });
  return {
    pairingUrl,
    expiresAt: initial.expiresAt,
    resumed: false,
    qr: withQr ? await renderQrCode(pairingUrl) : null,
  }; // NOTE Does NOT poll — call pollPairing() after.
}

export type PairingOutcome = { name: string };

export async function pollPairing(
  env: Environment = "prod",
  isCancelled: () => boolean = () => false,
): Promise<PairingOutcome> {
  const state = await loadPairingState(env);
  if (!state) throw new Error("No pairing session. Run /login first.");
  const expMs = Date.parse(state.expiresAt);
  const deadline = Number.isNaN(expMs) || expMs <= 0 ? Date.now() + 5 * 60 * 1000 : expMs;
  const secretKey = new Uint8Array(Buffer.from(state.secretKey, "base64"));

  while (Date.now() < deadline) {
    if (isCancelled()) throw new Error("Pairing cancelled.");
    const outcome = await requestAppPairing(env, state.appId, state.publicKey);
    if (outcome.status === "completed") {
      const token = decryptAppPairingToken(outcome.encryptedToken, secretKey);
      const ctx = await beeContext(env);
      const apiCtx: CommandContext = { ...ctx, client: createDeveloperClient(env) };
      const user = await fetchClientMe(apiCtx, token);
      await saveToken(env, token);
      await clearPairingState(env);
      return { name: [user.first_name, user.last_name].filter(Boolean).join(" ") };
    }
    if (outcome.status === "expired") {
      await clearPairingState(env);
      throw new Error("Pairing request expired. Please try again.");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Login timed out. Please try again.");
}

export async function logout(env: Environment = "prod"): Promise<void> {
  await clearProxyConfig(env);
  await clearToken(env);
  await clearPairingState(env);
  dropBeeContext();
}

export async function isLoggedIn(env: Environment = "prod"): Promise<boolean> {
  try {
    const ctx = await beeContext(env);
    if (ctx.client.isProxy) return true;
    return (await loadToken(env)) !== null;
  } catch {
    return false;
  }
}
