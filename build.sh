#!/usr/bin/env bash
# Queen: build a self-contained executable from an elthur dylib + a GGUF.
#
#   ./build.sh --list
#   ./build.sh -m qwen3.5 -p 4b -q q5_k_m --name queen
#   ./build.sh --no-model --name queen-lite
#   ./build.sh -m falcon-h1 --dylib /path/to/libelthur.dylib
#   ./build.sh [model.gguf] [--name queen-small]
#
# For both queen / queen-lite in one go use ./build_all.sh.
#
# Families: falcon-h1, qwen3.5, falcon-h1r, gemma4, apertus, lfm2.5
# Single-model defaults: --model falcon-h1, --params <lowest listed>, --quant q8_0.
# Output: tui/dist/$NAME (default: queen).
#
# --no-model builds the commands-only `queen-lite`: the elthur dylib is still
# staged so the bundler resolves it, but no GGUF is appended and inference is
# never initialized at runtime (see QUEEN_NO_MODEL).
#
# Env:
#   ELTHUR_DIR        elthur checkout used when --dylib is absent (default ../elthur)
#   QUEEN_MODELS_DIR  download directory (default ./models)
#   QUEEN_MODEL       model file to use when no model/url/--model is given
#   QUEEN_REBUILD_DYLIB  force an elthur rebuild instead of reusing a built dylib
#   QUEEN_NO_ELTHUR_UPDATE  skip `git submodule update --remote elthur`
#   QUEEN_SIGN_IDENTITY     codesign identity (default: first Developer ID found)
#   QUEEN_NO_WARM      skip the post-build warm run (see below)
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
NO_MODEL=""
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
lfm2.5     2.6b       LiquidAI/LFM2.5-2.6B-GGUF                  LFM2.5-2.6B-QUANT.gguf
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
    *) return 1 ;;
  esac
}

lowest_params() {
  catalog | awk -v f="$1" '$1 == f { print $2; exit }'
}

resolve_row() {
  catalog | awk -v f="$1" -v p="$2" '$1 == f && $2 == p { print $3 "|" $4; found = 1 } END { exit found ? 0 : 1 }'
}

usage() { sed -n '2,28p' "$0"; }

while [ $# -gt 0 ]; do
  case "$1" in
    -m | --model) FAMILY="${2:-}"; shift 2 ;;
    -p | --params) PARAMS="${2:-}"; shift 2 ;;
    -q | --quant) QUANT="${2:-}"; shift 2 ;;
    --name) NAME="${2:-}"; shift 2 ;;
    --dylib) DYLIB="${2:-}"; shift 2 ;;
    --url) URL="${2:-}"; shift 2 ;;
    --models-dir) MODELS_DIR="${2:-}"; shift 2 ;;
    --no-model) NO_MODEL=1; shift ;;
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

ensure_dylib() {
  if [ -n "$DYLIB" ]; then
    [ -f "$DYLIB" ] || {
      echo "dylib not found: $DYLIB" >&2
      exit 1
    }
  else
    # NOTE Elthur submodule dylib will always be the latest and developed to guarantee support
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
}

append_model() {
  local MODEL="$1" EXE="$2"
  local MAGIC="ELTHBLOB" VERSION=1 ALIGN=16384 # HACK: - Append a GGUF (plus ELTHBLOB trailer) tocompiled executable, synced code-wise with Elthur
  local size pad model_offset model_length mapped_length final

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
[ -d "$BEE_CLI/node_modules" ] || ( cd "$BEE_CLI" && bun install ) # FIXME Resolve Source deps in Bee-CLI submodule


ensure_dylib

if [ -n "$NO_MODEL" ]; then
  echo "==> no model: commands-only build (queen-lite)"
else
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
  export QUEEN_MODEL="$MODEL_PATH"
fi

TARGET="bun-darwin-arm64"
OUT="$TUI/dist/$NAME"

echo "==> typecheck"
( cd "$TUI" && bun run typecheck )

BEE_SHA="$(git -C "$BEE_CLI" rev-parse HEAD)"
echo "==> bee-cli: ${BEE_SHA:0:12}"
ELTHUR_SHA="$(git -C "$ELTHUR" rev-parse HEAD 2>/dev/null || echo unknown)"
echo "==> elthur: ${ELTHUR_SHA:0:12}"

echo "==> stage dylib"
cp "$DYLIB" "$TUI/libelthur.dylib"
codesign --force -s - "$TUI/libelthur.dylib"

echo "==> bundle"
mkdir -p "$TUI/dist"
DEFINES=(
  --define "process.env.QUEEN_BEE_SHA=\"$BEE_SHA\""
  --define "process.env.QUEEN_ELTHUR_SHA=\"$ELTHUR_SHA\""
  --define "process.env.QUEEN_MODEL_FAMILY=\"$FAMILY\""
)
if [ -n "$NO_MODEL" ]; then
  DEFINES+=(--define "process.env.QUEEN_NO_MODEL=\"1\"")
fi
( cd "$TUI" && bun build --compile index.tsx --target "$TARGET" --outfile "$OUT" "${DEFINES[@]}" )

if [ -n "$NO_MODEL" ]; then
  echo "==> no model to append; signing as-is"
else
  echo "==> de-sign"
  codesign --remove-signature "$OUT" 2>/dev/null || true #HACK first remove binary signature to append model safely and resign

  echo "==> append model"
  append_model "$MODEL_PATH" "$OUT"

  echo "==> patch __LINKEDIT"
  bun "$TUI/patchification.ts" "$OUT" #HACK Now the entire model is within the binary so we can sign it
fi

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

if [ -z "${QUEEN_NO_WARM:-}" ]; then
  echo "==> warm (prime signature validation)"
  QUEEN_WARM=1 "$OUT" >/dev/null 2>&1 || true #FIXME First execution will be slow, since MacOS tries to validate the entire signed blob (including model)
fi

echo "built $OUT ($(du -h "$OUT" | cut -f1))"
