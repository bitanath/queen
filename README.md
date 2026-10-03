# queen

Single-file chat binary (macOS arm64): OpenTUI frontend, Bee API in-process,
local GGUF inference via a thin elthur dylib. The Bun executable carries
everything — the dylib is embedded and the model is appended after the code.

## Layout

```
queen/
  build.sh            build one variant: pick/download model, compile, append, sign
  build_all.sh        build queen-low / queen-high in one go
  entitlements.plist  hardened-runtime entitlements for Developer-ID signing
  models/             downloaded GGUFs (gitignored)
  bee-cli/            submodule: upstream Bee API (sources imported by tui)
  elthur/             submodule: elthur sources + committed thin dylib (outputs/lib)
  tui/                OpenTUI + Bun app
    index.tsx         entry: smoke suite or TUI
    patchification.ts Mach-O patcher used by build.sh
    src/
    libelthur.dylib   staged from elthur submodule (gitignored)
    dist/queen        the built executable (gitignored)
```

## Build

Requires Bun >= 1.3.0. The elthur dylib comes from the `elthur/` submodule
(`elthur/outputs/lib/libelthur.dylib`); the build keeps it on latest `main`
(disable with `QUEEN_NO_ELTHUR_UPDATE=1`). On a fresh clone, initialize
submodules first:

```bash
git submodule update --init --recursive
```

```bash
./build_all.sh                              # queen-low, queen-high
./build.sh --list
./build.sh -m qwen3.5 -p 2b -q q8_0         # one-off, emits dist/queen
./build.sh -m falcon-h1 --dylib /path/to/libelthur.dylib
```

`./build_all.sh` builds both artifacts in one go (it just calls `./build.sh` twice,
once per model):

| artifact | model | notes |
|---|---|---|
| `dist/queen-low`  | MiniCPM5-1B Q4_K_M | |
| `dist/queen-high` | Qwen3.5-4B Q5_K_M  | reasoning |

Passing `-m` builds a single model as `dist/queen`; add `--name <n>` to emit
`dist/<n>`. Families: `falcon-h1`, `qwen3.5`, `falcon-h1r`, `gemma4`, `apertus`,
`lfm2.5`, `minicpm5`. `--params` defaults to the lowest option listed for the family;
`--quant` defaults to `q8_0`. The GGUF is downloaded to `models/` (resumable;
skipped if present), then `build` embeds the elthur dylib, compiles the TUI,
appends the GGUF + an `ELTHBLOB` trailer, and Developer-ID signs the result. The
dylib is the prebuilt thin one committed in the `elthur/` submodule; set
`QUEEN_REBUILD_DYLIB=1` to rebuild it from the submodule sources instead.

## Signing

The model lives *inside* the executable and the signature covers it. After
appending, `patchification.ts` grows `__LINKEDIT` to EOF — and relocates its `vmaddr`
off the dyld shared cache for large models — so codesign hashes the model too;
then `build` signs with a `Developer ID Application` identity if one is in the
keychain (override with `QUEEN_SIGN_IDENTITY`), else falls back to ad-hoc. On
macOS elthur finds the trailer at `LC_CODE_SIGNATURE.dataoff - 80`. This is not
notarization: distribute via `curl` (no quarantine → no Gatekeeper prompt).

## Dependencies

`bee-cli` is pinned by the parent commit. `elthur` is kept on latest `main` by
the build (`git submodule update --remote`); to freeze a release, build with
`QUEEN_NO_ELTHUR_UPDATE=1` and commit the resulting gitlink. Both revisions are
baked into the binary at build time and shown by `/status`.

## Run

```bash
./tui/dist/queen-low       # or queen-high / queen
```

Chat commands: `/search <q>`, `/today [--context]`, `/me`, `/status`,
`/login [--qr | --token <t>]`, `/logout`, `/theme`, `/help`, `/quit`. Plain text
runs through a Strands Agents loop backed by the local GGUF: the agent owns the
conversation history (memory) and the tool loop, and can call `get_weather` —
e.g. "What is the weather in Tokyo?" fetches the current conditions and the next
few hours from wttr.in, then answers.

Keyboard: `ctrl+opt+t` opens the theme switcher, `ctrl+opt+h` (or `/help`) opens
help, `esc` clears/cancels, `ctrl+c` quits. The theme picker previews live and
saves to `~/.bee/queen-theme.json`; `QUEEN_THEME=<name>` overrides it for a run.
Built-in themes: `opencode`, `default`, `gruvbox`, `nord`, `catppuccin`,
`tokyo-night`.

## Smoke test

The binary doubles as its own headless self-test — one env var runs generic
chat, the Strands agent, the tool path, and the Bee status module:

```bash
QUEEN_SMOKE=1 ./tui/dist/queen-low          # all checks, default prompt
QUEEN_SMOKE="Say hi" ./tui/dist/queen-high  # custom prompt
```

It prints `PASS`/`FAIL` per check and exits non-zero on any failure, so it works
in CI without a terminal.

## Credentials

Tokens are stored as dotfiles under `~/.bee/` (`token-<env>`, mode 0600)
rather than the macOS Keychain. The binary is re-signed on every build, so the
Keychain would prompt for your login password on each launch. Set
`BEE_FORCE_FILE_STORE=0` to use the Keychain instead.

## Dev (no append step)

Unchanged: the dev run loads the staged `tui/libelthur.dylib` and the GGUF via
`ELTHUR_MODEL`.

```bash
cd tui
bun install
ELTHUR_MODEL=$PWD/../models/<file>.gguf bun run index.tsx
```

After editing elthur, run `./build.sh` once (or copy
`elthur/outputs/lib/libelthur.dylib` to `tui/libelthur.dylib`) to restage the
dylib before `bun run dev`.

