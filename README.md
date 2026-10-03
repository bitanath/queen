# queen

Single-file chat binary (macOS arm64): OpenTUI frontend, Bee API in-process,
local GGUF inference via a thin elthur dylib. The Bun executable carries
everything — the dylib is embedded and the model is appended after the code.

## Layout

```
queen/
  build               build one variant: pick/download model, compile, append, sign
  build_all           build queen-low / queen-high in one go
  models/             downloaded GGUFs (gitignored)
  bee-cli/            submodule: upstream Bee API (sources imported by tui)
  elthur/             submodule: elthur sources + committed thin dylib (outputs/lib)
  tui/                OpenTUI + Bun app
    src/
    libelthur.dylib   staged from elthur submodule (gitignored)
    dist/queen        the built executable (gitignored)
```

## Build

Requires Bun >= 1.3.0. The elthur dylib is taken straight from the pinned
`elthur/` submodule (`elthur/outputs/lib/libelthur.dylib`), so no separate
checkout or Zig build is needed. On a fresh clone, initialize submodules first:

```bash
git submodule update --init --recursive
```

```bash
./build_all                                 # queen-low, queen-high
./build --list
./build -m qwen3.5 -p 2b -q q8_0            # one-off, emits dist/queen
./build -m falcon-h1 --dylib /path/to/libelthur.dylib
```

`./build_all` builds both artifacts in one go (it just calls `./build` twice,
once per model):

| artifact | model | notes |
|---|---|---|
| `dist/queen-low`  | MiniCPM5-1B Q4_K_M | |
| `dist/queen-high` | Qwen3.5-4B Q5_K_M  | reasoning |

Passing `-m` builds a single model as `dist/queen`; add `--name <n>` to emit
`dist/<n>`. Families: `falcon-h1`, `qwen3.5`, `falcon-h1r`, `gemma4`, `apertus`,
`lfm2.5`, `minicpm5`. `--params` defaults to the lowest option listed for the family;
`--quant` defaults to `q8_0`. The GGUF is downloaded to `models/` (resumable;
skipped if present), then `build` embeds the elthur dylib, compiles the TUI, and
appends the GGUF + an `ELTHBLOB` trailer. The dylib is the prebuilt thin one
committed in the `elthur/` submodule; set `QUEEN_REBUILD_DYLIB=1` to rebuild it
from the submodule sources instead. elthur maps the appended model at runtime
(`elthur/core/hosts.zig`), so there is no 2 GiB embed ceiling.

## Submodule pins

`bee-cli` and `elthur` are pinned submodules: the parent commit records the exact
upstream revision, so builds and dev runs never touch the network and the elthur
dylib always matches its sources. To move to a newer upstream, bump the pin
explicitly and review the breakage it causes:

```bash
# Bee API (upstream)
git -C bee-cli fetch origin main
git -C bee-cli checkout origin/main          # review the diff
bun run --cwd tui typecheck                  # upstream API breakage surfaces in src/bee.ts
git add bee-cli && git commit                # commit the new gitlink

# elthur (dylib + sources ship together)
git -C elthur fetch origin main
git -C elthur checkout origin/main           # review the diff + new outputs/lib dylib
git add elthur && git commit                 # commit the new gitlink
```

The pinned bee-cli SHA is baked into the binary at build time and shown by `/status`.

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
rather than the macOS Keychain. The binary is ad-hoc signed, so its signature
changes on every build and the Keychain would prompt for your login password on
each launch. Set `BEE_FORCE_FILE_STORE=0` to use the Keychain instead.

## Dev (no append step)

```bash
cd tui
bun install
ELTHUR_MODEL=$PWD/../models/<file>.gguf bun run index.tsx
```

