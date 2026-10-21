import { homedir } from "node:os";
import { join } from "node:path";

import { createCliRenderer } from "@opentui/core";

import { writeCard, plainCard, type CardSpec } from "../../interface/scrollback-card";
import {
  beeContext,
  getChanged,
  getMe,
  getNow,
  getStatus,
  getTodayBrief,
  getTodayContext,
  logout,
  startPairing,
  pollPairing,
  type CommandResult,
} from "../../utils/bee-com-bridge";
import { QUEEN_VERSION } from "../../app";

const BEE_SHA = process.env.QUEEN_BEE_SHA ?? "dev";
const ELTHUR_SHA = process.env.QUEEN_ELTHUR_SHA ?? "dev";

type CommandRun = (argv: string[]) => Promise<CardSpec>;

export function errorSpec(name: string, error: unknown): CardSpec {
  return {
    title: name,
    subtitle: "command failed",
    sections: [
      { kind: "text", text: error instanceof Error ? error.message : String(error) },
    ],
    footer: "queen",
  };
}

function tableSpecFromResult(result: CommandResult, title: string): CardSpec {
  const table = result.view?.table;
  if (table) {
    return {
      title,
      sections: [
        {
          kind: "table",
          columns: table.columns,
          rows: table.rows,
          ...(table.aligns ? { aligns: table.aligns } : {}),
        },
      ],
    };
  }
  return { title, sections: [{ kind: "markdown", content: result.text }] };
}

const status: CommandRun = async () => {
  const info = await getStatus();
  return {
    title: "status",
    subtitle: `${info.apiLabel} · ${info.apiUrl}`,
    sections: [
      {
        kind: "keyValues",
        items: [
          { key: "connected", value: info.connected ? "yes" : "no" },
          ...(info.verifiedName ? [{ key: "verified", value: `${info.verifiedName} (id ${info.verifiedId})` }] : []),
          ...(info.tokenMask ? [{ key: "token", value: info.tokenMask }] : []),
          ...(info.viaProxy ? [{ key: "proxy", value: info.viaProxy }] : []),
        ],
      },
      { kind: "gauge", label: "connection health", ratio: info.connected ? 1 : 0.15, detail: info.connected ? "healthy" : "offline" },
      {
        kind: "table",
        columns: ["component", "revision"],
        rows: [
          ["queen", QUEEN_VERSION],
          ["bee-cli", BEE_SHA],
          ["elthur", ELTHUR_SHA],
        ],
      },
    ],
  };
};

const me: CommandRun = async () => tableSpecFromResult(await getMe(), "me");

const today: CommandRun = async (argv) => {
  const context = argv.includes("--context");
  const result = context ? await getTodayContext() : await getTodayBrief();
  return {
    title: "today",
    subtitle: context ? "wearable context" : "calendar + email brief",
    sections: [{ kind: "markdown", content: result.text }],
  };
};

const now: CommandRun = async () => ({
  title: "now",
  subtitle: "recent conversations with utterances",
  sections: [{ kind: "markdown", content: await getNow() }],
});

const changed: CommandRun = async (argv) => {
  const cursorIndex = argv.indexOf("--cursor");
  const cursor = cursorIndex >= 0 ? argv[cursorIndex + 1] : undefined;
  return {
    title: "changed",
    subtitle: "recently changed entities",
    sections: [{ kind: "markdown", content: await getChanged("prod", cursor) }],
  };
};

const logoutCommand: CommandRun = async () => {
  await logout();
  return {
    title: "logout",
    sections: [{ kind: "text", text: "Logged out. Stored Bee credentials have been cleared." }],
  };
};

const ping: CommandRun = async () => {
  const ctx = await beeContext("prod");
  const started = performance.now();
  const response = await ctx.client.fetch("/v1/me", { method: "GET", signal: AbortSignal.timeout(5000) });
  const ms = Math.round(performance.now() - started);
  const ok = response.status >= 200 && response.status < 600;
  return {
    title: "ping",
    subtitle: ok ? `reply from ${new URL(ctx.client.baseUrl ?? "https://bee.computer").host}` : "no reply",
    sections: [
      {
        kind: "gauge",
        label: "latency",
        ratio: ok ? Math.max(0.1, Math.min(1, 1 - ms / 1000)) : 0,
        detail: ok ? `${ms} ms` : `status ${response.status}`,
      },
    ],
  };
};

const version: CommandRun = async () => ({
  title: "version",
  subtitle: "queen + pinned Bee CLI",
  sections: [
    {
      kind: "table",
      columns: ["component", "version"],
      rows: [
        ["queen", QUEEN_VERSION],
        ["bee-cli", `0.7.3 (${BEE_SHA.slice(0, 12)})`],
      ],
    },
  ],
});


const STATIC_COMMANDS: Record<string, CommandRun> = {
  status,
  today,
  now,
  changed,
  me,
  logout: logoutCommand,
  ping,
  version,
}; //TODO Live commands are handled separately because they need the renderer

function defaultSyncOutput(): string {
  return process.env.QUEEN_SYNC_DIR ?? join(homedir(), ".bee", "sync");
}

export async function renderSpec(spec: CardSpec): Promise<void> {
  if (!process.stdout.isTTY) {
    process.stdout.write(`${plainCard(spec)}\n`);
    return;
  }
  const renderer = await createCliRenderer({
    screenMode: "split-footer",
    footerHeight: 1,
    externalOutputMode: "capture-stdout",
    clearOnShutdown: false,
  });
  try {
    await writeCard(renderer, spec);
  } finally {
    renderer.destroy();
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}


async function syncSpec(argv: string[]): Promise<CardSpec> {
  const { syncCommand } = await import("@/commands/sync");
  const ctx = await beeContext("prod");
  const outputDir = defaultSyncOutput(); //FIXME special casing bee sync to only take up one line per actual sync item
  const args = argv.includes("--output") ? argv : ["--output", outputDir, ...argv];
  await syncCommand.run(args, ctx);
  return {
    title: "sync",
    subtitle: "Bee data export",
    sections: [
      { kind: "keyValues", items: [{ key: "output", value: outputDir }] },
      { kind: "text", text: "Sync complete." },
    ],
    footer: "queen",
  };
}

async function loginSpec(
  argv: string[],
  emit?: (spec: CardSpec) => Promise<void>,
): Promise<CardSpec> {
  const withQr = argv.includes("--qr");
  const start = await startPairing({ withQr });
  if (emit) {
    await emit({
      title: "login",
      subtitle: start.resumed ? "resuming pairing session" : "approve in the Bee app",
      sections: [
        { kind: "text", text: start.pairingUrl },
        ...(start.qr ? [{ kind: "text" as const, text: start.qr }] : []),
        { kind: "text", text: "waiting for approval…" },
      ],
      footer: "queen",
    });
  }
  const outcome = await pollPairing({});
  return {
    title: "login",
    subtitle: "connected",
    sections: [{ kind: "text", text: `Connected to Bee as ${outcome.name}.` }],
    footer: "queen",
  };
}

/** Build the card for a queen-owned command (status, today, sync, login, ...). */
export async function externalSpec(
  name: string,
  argv: string[],
  emit?: (spec: CardSpec) => Promise<void>,
): Promise<CardSpec> {
  if (name === "sync") return syncSpec(argv);
  if (name === "login") return loginSpec(argv, emit);
  const run = STATIC_COMMANDS[name];
  if (!run) throw new Error(`Unknown command: ${name}`);
  return run(argv);
}
