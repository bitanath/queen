#!/usr/bin/env bash
# Queen: build one self-contained executable from an elthur dylib + a GGUF.
#
#   ./build.sh --list
#   ./build.sh -m qwen3.5 -p 0.8b -q q6_k --name queen-medium
#   ./build.sh -m falcon-h1 --dylib /path/to/libelthur.dylib
#   ./build.sh [model.gguf] [--name queen-small]
#
# For all three queen-* variants in one go use ./build_all.sh.
#
# Families: falcon-h1, qwen3.5, falcon-h1r, gemma4, apertus, lfm2.5, minicpm5
# Single-model defaults: --model falcon-h1, --params <lowest listed>, --quant q8_0.
# Output: tui/dist/$NAME (default: queen).
#
# Env:
#   ELTHUR_DIR        elthur checkout used when --dylib is absent (default ../elthur)
#   QUEEN_MODELS_DIR  download directory (default ./models)
#   QUEEN_DYLIB       prebuilt dylib to stage (overridden by --dylib)
#   QUEEN_MODEL       model file to use when no model/url/--model is given
#   QUEEN_REBUILD_DYLIB  force an elthur rebuild instead of reusing a built dylib
#   QUEEN_NO_ELTHUR_UPDATE  skip `git submodule update --remote elthur`
#   QUEEN_SIGN_IDENTITY     codesign identity (default: first Developer ID found)
#   HF_TOKEN          bearer token, for gated/rate-limited downloads
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
TUI="$ROOT/tui"
BEE_CLI="$ROOT/bee-cli"
MODELS_DIR="${QUEEN_MODELS_DIR:-$ROOT/models}"
ELTHUR="${ELTHUR_DIR:-$ROOT/elthur}"

FAMILY=""
PARAMS=""
QUANT="q8_0"
NAME="queen"
DYLIB=""
URL=""
POSITIONAL=()

# family  params       repo                                        filename template (QUANT substituted)
catalog() {
  cat <<'EOF'
falcon-h1  0.5b       tiiuae/Falcon-H1-0.5B-Instruct-GGUF       Falcon-H1-0.5B-Instruct-QUANT.gguf
falcon-h1  1.5b-deep  tiiuae/Falcon-H1-1.5B-Deep-Instruct-GGUF  Falcon-H1-1.5B-Deep-Instruct-QUANT.gguf
qwen3.5    0.8b       bartowski/Qwen_Qwen3.5-0.8B-GGUF          Qwen_Qwen3.5-0.8B-QUANT.gguf
qwen3.5    2b         lmstudio-community/Qwen3.5-2B-GGUF        Qwen3.5-2B-QUANT.gguf
qwen3.5    4b         unsloth/Qwen3.5-4B-GGUF                    Qwen3.5-4B-QUANT.gguf
falcon-h1r 0.6b       tiiuae/Falcon-H1-Tiny-R-0.6B-GGUF         Falcon-H1R-0.6B-QUANT.gguf
gemma4     e4b        unsloth/gemma-4-E4B-it-GGUF                gemma-4-E4B-it-QUANT.gguf
apertus    8b         andreasmartin/apertus-v1.5-8b-text-Q8_0-GGUF apertus-v1.5-8b-text-quant.gguf
lfm2.5     230m       LiquidAI/LFM2.5-230M-GGUF                  LFM2.5-230M-QUANT.gguf
minicpm5   1b         openbmb/MiniCPM5-1B-GGUF                   MiniCPM5-1B-QUANT.gguf
EOF
}

alias_family() {
  case "$1" in
    falcon-h1 | falcon | h1) echo "falcon-h1" ;;
    qwen3.5 | qwen | qwen3 | q35) echo "qwen3.5" ;;
    falcon-h1r | h1r | falcon-r | reasoning) echo "falcon-h1r" ;;
    gemma4 | gemma | e4b) echo "gemma4" ;;
    apertus | ap) echo "apertus" ;;
    lfm2.5 | lfm2 | lfm) echo "lfm2.5" ;;
    minicpm5 | minicpm | cpm | cpm5 | mini) echo "minicpm5" ;;
    *) return 1 ;;
  esac
}

# First catalog row for a family = its lowest parameter option.
lowest_params() {
  catalog | awk -v f="$1" '$1 == f { print $2; exit }'
}

# "repo|filename-template" for a family+params pair.
resolve_row() {
  catalog | awk -v f="$1" -v p="$2" '$1 == f && $2 == p { print $3 "|" $4; found = 1 } END { exit found ? 0 : 1 }'
}

usage() { sed -n '2,23p' "$0"; }

while [ $# -gt 0 ]; do
  case "$1" in
    -m | --model) FAMILY="${2:-}"; shift 2 ;;
    -p | --params) PARAMS="${2:-}"; shift 2 ;;
    -q | --quant) QUANT="${2:-}"; shift 2 ;;
    --name) NAME="${2:-}"; shift 2 ;;
    --dylib) DYLIB="${2:-}"; shift 2 ;;
    --url) URL="${2:-}"; shift 2 ;;
    --models-dir) MODELS_DIR="${2:-}"; shift 2 ;;
    --list) catalog; exit 0 ;;
    -h | --help) usage; exit 0 ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done

if [ "${#POSITIONAL[@]}" -gt 1 ]; then
  echo "at most one model file may be given (got: ${POSITIONAL[*]})" >&2
  usage >&2
  exit 2
fi

# Resolve family/params/quant, download if needed, set MODEL_PATH.
MODEL_PATH=""
fetch_model() {
  local family="$1" params="$2" quant="$3"
  local row repo mask qu ql file url
  row="$(resolve_row "$family" "$params")" || {
    echo "family '$family' has no parameter option '$params' (try --list)" >&2
    return 1
  }
  repo="${row%|*}"
  mask="${row#*|}"
  qu="$(printf '%s' "$quant" | tr '[:lower:]' '[:upper:]')"
  ql="$(printf '%s' "$quant" | tr '[:upper:]' '[:lower:]')"
  file="${mask/QUANT/$qu}"
  file="${file/quant/$ql}"
  url="https://huggingface.co/$repo/resolve/main/$file"
  mkdir -p "$MODELS_DIR"
  MODEL_PATH="$MODELS_DIR/$file"
  echo "==> model: $family / $params / $quant ($file)"
  if [ -s "$MODEL_PATH" ]; then
    echo "==> model present: $MODEL_PATH ($(du -h "$MODEL_PATH" | cut -f1))"
  else
    echo "==> downloading $url"
    if [ -n "${HF_TOKEN:-}" ]; then
      curl -fL --retry 3 --retry-delay 2 -C - -H "Authorization: Bearer $HF_TOKEN" -o "$MODEL_PATH" "$url"
    else
      curl -fL --retry 3 --retry-delay 2 -C - -o "$MODEL_PATH" "$url"
    fi
    echo "==> saved $MODEL_PATH ($(du -h "$MODEL_PATH" | cut -f1))"
  fi
}

# Pick the elthur dylib once: --dylib wins, then QUEEN_DYLIB, otherwise take the
# dylib committed in the elthur submodule (outputs/lib). Because that dylib is
# committed alongside the source it was built from and the submodule pins the
# exact revision, a plain checkout always yields a matching dylib -- no Zig
# build needed. Set QUEEN_REBUILD_DYLIB to force scripts/build.sh instead.
ensure_dylib() {
  if [ -n "$DYLIB" ]; then
    [ -f "$DYLIB" ] || {
      echo "dylib not found: $DYLIB" >&2
      exit 1
    }
  elif [ -n "${QUEEN_DYLIB:-}" ]; then
    DYLIB="$QUEEN_DYLIB"
    [ -f "$DYLIB" ] || {
      echo "dylib not found: $DYLIB" >&2
      exit 1
    }
  else
    # Default to the elthur submodule and keep it on latest main. Disable with
    # QUEEN_NO_ELTHUR_UPDATE=1 (offline / reproducible); skipped entirely when an
    # explicit ELTHUR_DIR checkout is in use.
    if [ -d "$ROOT/.git" ] && [ -z "${ELTHUR_DIR:-}" ]; then
      if [ -n "${QUEEN_NO_ELTHUR_UPDATE:-}" ]; then
        [ -f "$ELTHUR/outputs/lib/libelthur.dylib" ] ||
          git -C "$ROOT" submodule update --init elthur || true
      else
        echo "==> elthur: submodule update --remote"
        git -C "$ROOT" submodule update --init --remote elthur ||
          echo "  (elthur update failed; using current checkout)"
      fi
    fi
    DYLIB="$ELTHUR/outputs/lib/libelthur.dylib"
    if [ -n "${QUEEN_REBUILD_DYLIB:-}" ] || [ ! -f "$DYLIB" ]; then
      echo "==> elthur: scripts/build.sh"
      ( cd "$ELTHUR" && ./scripts/build.sh )
    fi
    [ -f "$DYLIB" ] || {
      echo "dylib not found: $DYLIB" >&2
      echo "run: git -C \"$ROOT\" submodule update --init elthur" >&2
      exit 1
    }
  fi
  export QUEEN_DYLIB="$DYLIB"
}

# Append a GGUF (plus an ELTHBLOB trailer) to a compiled executable.
# The engine (elthur core/hosts.zig) finds the model by reading the fixed
# 80-byte trailer at the end of the running executable and mmapping the bytes
# recorded there. Appending is idempotent: if a valid trailer already exists the
# file is truncated back to its original size first, so re-running the build
# never stacks models.
#
# Trailer layout (little-endian C struct "<8sIIQQQQ32s", 80 bytes):
#   0  magic "ELTHBLOB"
#   8  u32 version (1)
#   12 u32 flags (0)
#   16 u64 model_offset
#   24 u64 model_length
#   32 u64 mapped_length (align_up(model_length, ALIGN))
#   40 u64 executable size before the model
#   48 32-byte digest (all zero = skip verification)
#
# The model is aligned to ALIGN (arm64 page size) so it stays mmap-able.
append_model() {
  local MODEL="$1" EXE="$2"
  local MAGIC="ELTHBLOB" VERSION=1 ALIGN=16384 TRAILER=80
  local size before offset magic version candidate pad model_offset model_length mapped_length final tmp

  size_of() {
    stat -f%z "$1" 2>/dev/null || wc -c < "$1"
  }
  align_up() {
    echo $(( ($1 + $2 - 1) / $2 * $2 ))
  }
  le32() {
    local v=$1 i oct out=""
    for i in 0 1 2 3; do
      oct="$(printf '%03o' $(( v & 255 )))"
      out="$out\\$oct"
      v=$(( v >> 8 ))
    done
    printf '%b' "$out"
  }
  le64() {
    local v=$1 i oct out=""
    for i in 0 1 2 3 4 5 6 7; do
      oct="$(printf '%03o' $(( v & 255 )))"
      out="$out\\$oct"
      v=$(( v >> 8 ))
    done
    printf '%b' "$out"
  }

  # --- idempotency: recover the pre-model size from an existing trailer ------
  size="$(size_of "$EXE")"
  before=""
  if [ "$size" -ge "$TRAILER" ]; then
    offset=$(( size - TRAILER ))
    magic="$(tail -c "$TRAILER" "$EXE" | head -c 8)"
    if [ "$magic" = "$MAGIC" ]; then
      version="$(od -An -tu4 -j $(( offset + 8 )) -N 4 "$EXE" | tr -d ' ')"
      candidate="$(od -An -tu8 -j $(( offset + 40 )) -N 8 "$EXE" | tr -d ' ')"
      if [ "$version" = "$VERSION" ] && [ "$candidate" -gt 0 ] && [ "$candidate" -le "$size" ]; then
        before="$candidate"
      fi
    fi
  fi

  if [ -n "$before" ]; then
    if command -v truncate >/dev/null 2>&1; then
      truncate -s "$before" "$EXE"
    else
      tmp="$EXE.tmp.$$"
      head -c "$before" "$EXE" > "$tmp" && mv "$tmp" "$EXE"
    fi
    echo "  re-append: truncated $EXE to $before bytes"
  fi

  # --- append model + trailer -----------------------------------------------
  size="$(size_of "$EXE")"
  model_offset="$(align_up "$size" "$ALIGN")"
  model_length="$(size_of "$MODEL")"
  mapped_length="$(align_up "$model_length" "$ALIGN")"
  pad=$(( model_offset - size ))

  {
    if [ "$pad" -gt 0 ]; then
      head -c "$pad" /dev/zero
    fi
    cat "$MODEL"
    printf '%s' "$MAGIC"
    le32 "$VERSION"
    le32 0
    le64 "$model_offset"
    le64 "$model_length"
    le64 "$mapped_length"
    le64 "$size"
    head -c 32 /dev/zero
  } >> "$EXE"

  final="$(size_of "$EXE")"
  echo "  appended $MODEL: $model_length bytes at offset $model_offset (exe $final bytes)"
}

[ -d "$TUI/node_modules" ] || ( cd "$TUI" && bun install )
# bee-cli is a root-level submodule now, so its sources resolve their own deps
# (date-fns, handlebars, qrcode, tweetnacl) from bee-cli/node_modules.
[ -d "$BEE_CLI/node_modules" ] || ( cd "$BEE_CLI" && bun install )

# Resolve the model: a positional file or --url wins, else family/params/quant.
if [ "${#POSITIONAL[@]}" -eq 1 ]; then
  MODEL_PATH="${POSITIONAL[0]}"
elif [ -n "$URL" ]; then
  FILE="$(basename "${URL%%\?*}")"
  echo "==> model: $FILE (from --url)"
  mkdir -p "$MODELS_DIR"
  MODEL_PATH="$MODELS_DIR/$FILE"
  if [ -s "$MODEL_PATH" ]; then
    echo "==> model present: $MODEL_PATH ($(du -h "$MODEL_PATH" | cut -f1))"
  else
    echo "==> downloading $URL"
    if [ -n "${HF_TOKEN:-}" ]; then
      curl -fL --retry 3 --retry-delay 2 -C - -H "Authorization: Bearer $HF_TOKEN" -o "$MODEL_PATH" "$URL"
    else
      curl -fL --retry 3 --retry-delay 2 -C - -o "$MODEL_PATH" "$URL"
    fi
    echo "==> saved $MODEL_PATH ($(du -h "$MODEL_PATH" | cut -f1))"
  fi
elif [ -z "$FAMILY" ] && [ -n "${QUEEN_MODEL:-}" ]; then
  MODEL_PATH="$QUEEN_MODEL"
else
  raw_family="${FAMILY:-falcon-h1}"
  FAMILY="$(alias_family "$raw_family")" || {
    echo "unknown model family: $raw_family (try --list)" >&2
    exit 2
  }
  if [ -z "$PARAMS" ]; then
    PARAMS="$(lowest_params "$FAMILY")"
  fi
  fetch_model "$FAMILY" "$PARAMS" "$QUANT"
fi

[ -f "$MODEL_PATH" ] || {
  echo "model not found: $MODEL_PATH" >&2
  exit 1
}

ensure_dylib
export QUEEN_MODEL="$MODEL_PATH"

TARGET="bun-darwin-arm64"
OUT="$TUI/dist/$NAME"

echo "==> typecheck"
( cd "$TUI" && bun run typecheck )

# Vendor pins: bake the sha of each dependency into the bundle for /status. No
# network, no generated source file. elthur is usually latest main (see
# ensure_dylib above), so this records exactly which revision a build used.
BEE_SHA="$(git -C "$BEE_CLI" rev-parse HEAD)"
echo "==> bee-cli: ${BEE_SHA:0:12}"
ELTHUR_SHA="$(git -C "$ELTHUR" rev-parse HEAD 2>/dev/null || echo unknown)"
echo "==> elthur: ${ELTHUR_SHA:0:12}"

echo "==> stage dylib"
cp "$DYLIB" "$TUI/libelthur.dylib"
codesign --force -s - "$TUI/libelthur.dylib"

echo "==> bundle"
mkdir -p "$TUI/dist"
( cd "$TUI" && bun build --compile index.tsx --target "$TARGET" --outfile "$OUT" \
  --define "process.env.QUEEN_BEE_SHA=\"$BEE_SHA\"" \
  --define "process.env.QUEEN_ELTHUR_SHA=\"$ELTHUR_SHA\"" )

# One file, validly signed: append the model, then grow __LINKEDIT to cover it
# (so the signature hashes the model too), then sign. Signing before appending
# is what forced the old, invalid signature; this order fixes it. elthur finds
# the trailer just before the code signature on macOS.
echo "==> de-sign"
codesign --remove-signature "$OUT" 2>/dev/null || true

echo "==> append model"
append_model "$MODEL_PATH" "$OUT"

echo "==> patch __LINKEDIT"
bun "$TUI/patchification.ts" "$OUT"

echo "==> sign"
IDENTITY="${QUEEN_SIGN_IDENTITY:-}"
if [ -z "$IDENTITY" ]; then
  IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Developer ID Application:.*\)"/\1/p' | head -1)"
fi
if [ -n "$IDENTITY" ]; then
  echo "  identity: $IDENTITY"
  codesign --force --options runtime --entitlements "$ROOT/entitlements.plist" --sign "$IDENTITY" "$OUT"
else
  echo "  no Developer ID Application identity found; ad-hoc signing"
  codesign --force -s - "$OUT"
fi
echo "built $OUT ($(du -h "$OUT" | cut -f1))"
