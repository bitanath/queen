# queen

Single-file chat binary (macOS arm64): OpenTUI frontend, Bee API in-process,
local GGUF inference via a thin elthur dylib. The Bun executable carries
everything — the dylib is embedded and the model is appended after the code.

## Layout

```
queen/
  build.sh            pick a model, download it, build everything
  models/             downloaded GGUFs (gitignored)
  tui/                OpenTUI + Bun app
    bee-cli/          submodule: upstream Bee API (sources imported by tui)
    build.sh          stage dylib -> bun compile -> append model -> sign
    src/  scripts/
    libelthur.dylib   staged thin dylib (gitignored)
    dist/queen        the built executable (gitignored)
```

## Build

Requires Bun >= 1.3.0 and a sibling `elthur` checkout.

```bash
./build.sh --list
./build.sh                                  # falcon-h1 / 0.5b / q8_0 (defaults)
./build.sh -m qwen3.5 -p 2b -q q8_0
./build.sh -m falcon-h1 --dylib /path/to/libelthur.dylib
```

Families: `falcon-h1`, `qwen3.5`, `falcon-h1r`. `--params` defaults to the
lowest option listed for the family; `--quant` defaults to `q8_0`. The GGUF is
downloaded to `models/` (resumable; skipped if present), then `tui/build.sh`
builds elthur (static lib + code-only dylib), embeds the dylib in the Bun
executable, and appends the GGUF + an `ELTHBLOB` trailer. elthur maps the
appended model at runtime (`elthur/core/hosts.zig`), so there is no 2 GiB
embed ceiling.

## Run

```bash
./tui/dist/queen
```

Chat commands: `/search <q>`, `/today [--context]`, `/me`, `/status`,
`/login [--qr | --token <t>]`, `/logout`, `/help`, `/quit`.

## Credentials

Tokens are stored as dotfiles under `~/.bee/` (`token-<env>`, mode 0600)
rather than the macOS Keychain. The binary is ad-hoc signed, so its signature
changes on every build and the Keychain would prompt for your login password on
each launch. Set `BEE_FORCE_FILE_STORE=0` to use the Keychain instead.

## Dev (no append step)

```bash
cd tui
bun install
ELTHUR_MODEL=$PWD/../models/<file>.gguf bun run src/index.tsx
```

`bee-cli` is a pinned submodule: the parent commit records the exact upstream
revision, so builds and dev runs never touch the network. To move to a newer
upstream, bump the pin explicitly and review the breakage it causes:

```bash
git -C tui/bee-cli fetch origin main
git -C tui/bee-cli checkout origin/main      # review the diff
bun run --cwd tui typecheck                  # upstream API breakage surfaces in src/bee.ts
git add tui/bee-cli && git commit            # commit the new gitlink
```

The pinned SHA is baked into the binary at build time and shown by `/status`.
