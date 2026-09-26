#!/usr/bin/env bash
# Build the self-contained queen executable from an elthur dylib + a GGUF.
#
#   ./build.sh --list
#   ./build.sh                                  # defaults: falcon-h1 / 0.5b / q8_0
#   ./build.sh -m qwen3.5 -p 2b -q q8_0
#   ./build.sh -m falcon-h1r -p 0.6b -q q4_k_m
#   ./build.sh -m falcon-h1 --dylib /path/to/libelthur.dylib
#
# Families: falcon-h1, qwen3.5, falcon-h1r
# Defaults: --model falcon-h1, --params <lowest listed for that family>, --quant q8_0.
#
# Env:
#   ELTHUR_DIR        elthur checkout used when --dylib is absent (default ../elthur)
#   QUEEN_MODELS_DIR  download directory (default ./models)
#   HF_TOKEN          bearer token, for gated/rate-limited downloads
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
TUI="$ROOT/tui"
MODELS_DIR="${QUEEN_MODELS_DIR:-$ROOT/models}"

FAMILY=""
PARAMS=""
QUANT="q8_0"
DYLIB=""
URL=""

# family  params       repo                                        filename template (QUANT substituted)
catalog() {
  cat <<'EOF'
falcon-h1  0.5b       tiiuae/Falcon-H1-0.5B-Instruct-GGUF       Falcon-H1-0.5B-Instruct-QUANT.gguf
falcon-h1  1.5b-deep  tiiuae/Falcon-H1-1.5B-Deep-Instruct-GGUF  Falcon-H1-1.5B-Deep-Instruct-QUANT.gguf
qwen3.5    0.8b       bartowski/Qwen_Qwen3.5-0.8B-GGUF          Qwen_Qwen3.5-0.8B-QUANT.gguf
qwen3.5    2b         lmstudio-community/Qwen3.5-2B-GGUF        Qwen3.5-2B-QUANT.gguf
qwen3.5    4b         lmstudio-community/Qwen3.5-4B-GGUF        Qwen3.5-4B-QUANT.gguf
falcon-h1r 0.6b       tiiuae/Falcon-H1-Tiny-R-0.6B-GGUF         Falcon-H1R-0.6B-QUANT.gguf
gemma4     e4b        unsloth/gemma-4-E4B-it-GGUF                gemma-4-E4B-it-QUANT.gguf
apertus    8b         andreasmartin/apertus-v1.5-8b-text-Q8_0-GGUF apertus-v1.5-8b-text-quant.gguf
EOF
}

alias_family() {
  case "$1" in
    falcon-h1 | falcon | h1) echo "falcon-h1" ;;
    qwen3.5 | qwen | qwen3 | q35) echo "qwen3.5" ;;
    falcon-h1r | h1r | falcon-r | reasoning) echo "falcon-h1r" ;;
    gemma4 | gemma | e4b) echo "gemma4" ;;
    apertus | ap) echo "apertus" ;;
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

usage() { sed -n '2,16p' "$0"; }

while [ $# -gt 0 ]; do
  case "$1" in
    -m | --model) FAMILY="${2:-}"; shift 2 ;;
    -p | --params) PARAMS="${2:-}"; shift 2 ;;
    -q | --quant) QUANT="${2:-}"; shift 2 ;;
    --dylib) DYLIB="${2:-}"; shift 2 ;;
    --url) URL="${2:-}"; shift 2 ;;
    --models-dir) MODELS_DIR="${2:-}"; shift 2 ;;
    --list) catalog; exit 0 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# Family defaults to falcon-h1; params default to that family's lowest option.
raw_family="${FAMILY:-falcon-h1}"
FAMILY="$(alias_family "$raw_family")" || {
  echo "unknown model family: $raw_family (try --list)" >&2
  exit 2
}
if [ -z "$PARAMS" ]; then
  PARAMS="$(lowest_params "$FAMILY")"
fi
QUANT_UP="$(printf '%s' "$QUANT" | tr '[:lower:]' '[:upper:]')"
QUANT_LOWER="$(printf '%s' "$QUANT" | tr '[:upper:]' '[:lower:]')"

if [ -n "$URL" ]; then
  FILE="$(basename "${URL%%\?*}")"
  echo "==> model: $FILE (from --url)"
else
  row="$(resolve_row "$FAMILY" "$PARAMS")" || {
    echo "family '$FAMILY' has no parameter option '$PARAMS' (try --list)" >&2
    exit 2
  }
  REPO="${row%|*}"
  MASK="${row#*|}"
  FILE="${MASK/QUANT/$QUANT_UP}"
  FILE="${FILE/quant/$QUANT_LOWER}"
  URL="https://huggingface.co/$REPO/resolve/main/$FILE"
  echo "==> model: $FAMILY / $PARAMS / $QUANT ($FILE)"
fi

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

[ -d "$TUI/node_modules" ] || ( cd "$TUI" && bun install )

export QUEEN_MODEL="$MODEL_PATH"
if [ -n "$DYLIB" ]; then
  [ -f "$DYLIB" ] || {
    echo "dylib not found: $DYLIB" >&2
    exit 1
  }
  export QUEEN_DYLIB="$DYLIB"
fi

exec "$TUI/build.sh"
