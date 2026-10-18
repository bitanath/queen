#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${QUEEN_IMAGE:-ghcr.io/bitanath/queen-bee}"
TAG="${QUEEN_IMAGE_TAG:-latest}"
MODEL_FILE="${QUEEN_MODEL_FILE:-LFM2.5-2.6B-Q5_K_M.gguf}"
PLATFORMS="${QUEEN_PLATFORMS:-linux/amd64,linux/arm64}"
VERIFY_PLATFORM="${QUEEN_VERIFY_PLATFORM:-linux/arm64}"
LOG="${QUEEN_IMAGE_LOG:-/tmp/queen-image.log}"
BUILDER="${QUEEN_BUILDER:-queen-bee}"
BEE_DIR="${QUEEN_BEE_DIR:-$HOME/.bee}"
CPUS="${QUEEN_COLIMA_CPUS:-12}"
MEMORY="${QUEEN_COLIMA_MEMORY:-8}"
ROSETTA="${QUEEN_COLIMA_ROSETTA:-1}"

usage() {
  cat >&2 <<EOF
usage: $0 <build|monitor|verify|amd64|tui|audit|shas|status|stop|clean|all>

  build    require a clean tree, then build $PLATFORMS and push $IMAGE:$TAG
  monitor  tail -f $LOG
  verify   pull $VERIFY_PLATFORM, run uname/version/status with $BEE_DIR mounted,
           then check the baked revisions and audit for credentials
  amd64    same as verify but for linux/amd64
  tui      interactive queen in a container, $BEE_DIR mounted
  audit    prove the image itself carries no credentials
  shas     prove the baked revisions match the gitlinks recorded in HEAD
  status   show the pushed manifest list
  stop     remove the builder and stop colima
  clean    remove the builder and delete colima entirely
  all      build, verify, stop

env:
  QUEEN_ALLOW_DIRTY=1      skip the clean-tree check, for a scratch build
  QUEEN_FORCE_PULL=1       drop the local image first, so the pull is really tested
  QUEEN_COLIMA_ROSETTA=0   start colima with binfmt/QEMU instead of Rosetta
EOF
  exit 2
}

log() {
  printf '\n== %s\n' "$*" | tee -a "$LOG"
}

run_logged() {
  "$@" 2>&1 | tee -a "$LOG"
}

recorded_sha() {
  git -C "$ROOT" rev-parse "HEAD:$1" 2>/dev/null || echo docker
}

repo_dirty() {
  local path="$1" reasons=""
  if ! git -C "$path" rev-parse --git-dir >/dev/null 2>&1; then
    printf 'not-a-git-repo'
    return 0
  fi
  git -C "$path" diff --quiet --ignore-submodules=all 2>/dev/null || reasons="${reasons:+$reasons }unstaged"
  git -C "$path" diff --cached --quiet --ignore-submodules=all 2>/dev/null || reasons="${reasons:+$reasons }staged"
  local untracked
  untracked="$(git -C "$path" ls-files --others --exclude-standard 2>/dev/null | head -3)"
  [ -z "$untracked" ] || reasons="${reasons:+$reasons }untracked[$(printf '%s' "$untracked" | tr '\n' ',')]"
  printf '%s' "$reasons"
}

print_lines() {
  local line
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    printf '  %s\n' "$line" | tee -a "$LOG"
  done <<< "$1"
}

require_clean() {
  if [ -n "${QUEEN_ALLOW_DIRTY:-}" ]; then
    log "require_clean: skipped (QUEEN_ALLOW_DIRTY set)"
    return 0
  fi
  local fatal="" warning="" sub head recorded reasons

  for sub in elthur; do
    reasons="$(repo_dirty "$ROOT/$sub")"
    [ -z "$reasons" ] || fatal="${fatal}${sub}: local edits ($reasons)"$'\n'
  done
  reasons="$(repo_dirty "$ROOT")"
  [ -z "$reasons" ] || fatal="${fatal}queen: local edits ($reasons)"$'\n'

  reasons="$(repo_dirty "$ROOT/bee-cli")"
  [ -z "$reasons" ] || warning="${warning}bee-cli: local edits ($reasons)"$'\n'

  for sub in elthur bee-cli; do
    head="$(git -C "$ROOT/$sub" rev-parse HEAD 2>/dev/null || echo none)"
    recorded="$(git -C "$ROOT" rev-parse "HEAD:$sub" 2>/dev/null || echo none)"
    if [ "$head" != "$recorded" ]; then
      fatal="${fatal}${sub}: gitlink says ${recorded:0:12} but the submodule is at ${head:0:12}"$'\n'
    fi
  done

  if [ -n "$warning" ]; then
    log "require_clean: warning, third-party submodule has local edits"
    print_lines "$warning"
  fi
  if [ -n "$fatal" ]; then
    log "require_clean: REFUSING to build, the tree does not match the recorded revision"
    print_lines "$fatal"
    echo "  commit the changes, or set QUEEN_ALLOW_DIRTY=1 for a scratch build" | tee -a "$LOG"
    return 1
  fi
  log "require_clean: queen and elthur clean, gitlinks match the recorded SHAs"
}

colima_up() {
  if ! colima status >/dev/null 2>&1; then
    if [ "$ROSETTA" = "1" ]; then
      colima start --cpu "$CPUS" --memory "$MEMORY" --vz-rosetta
    else
      colima start --cpu "$CPUS" --memory "$MEMORY"
    fi
  fi
  if docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
    docker buildx use "$BUILDER"
  else
    docker buildx create --name "$BUILDER" --driver docker-container --use
  fi
  docker buildx inspect --bootstrap >/dev/null
}

need_model() {
  [ -s "$ROOT/models/$MODEL_FILE" ] || {
    echo "missing model: $ROOT/models/$MODEL_FILE" >&2
    exit 1
  }
}

with_creds() {
  local platform="$1"
  shift
  if [ -d "$BEE_DIR" ]; then
    run_logged docker run --rm --platform "$platform" -v "$BEE_DIR:/root/.bee" "$IMAGE:$TAG" "$@"
  else
    echo "no credentials at $BEE_DIR; running without" | tee -a "$LOG"
    run_logged docker run --rm --platform "$platform" "$IMAGE:$TAG" "$@"
  fi
}

cmd_build() {
  require_clean
  need_model
  colima_up
  log "build $PLATFORMS as $IMAGE:$TAG"
  docker buildx build \
    --platform "$PLATFORMS" \
    --build-arg "MODEL_FILE=$MODEL_FILE" \
    --build-arg "QUEEN_BEE_SHA=$(recorded_sha bee-cli)" \
    --build-arg "QUEEN_ELTHUR_SHA=$(recorded_sha elthur)" \
    --tag "$IMAGE:$TAG" \
    --push \
    --progress plain \
    "$ROOT" 2>&1 | tee "$LOG"
}

cmd_monitor() {
  tail -f "$LOG"
}

cmd_pull() {
  if [ -n "${QUEEN_FORCE_PULL:-}" ]; then
    docker rmi "$IMAGE:$TAG" >/dev/null 2>&1 || true
  fi
  log "pull $1 $IMAGE:$TAG"
  run_logged docker pull --platform "$1" "$IMAGE:$TAG"
}

cmd_shas() {
  local platform="${1:-$VERIFY_PLATFORM}"
  local out="" ok=1 pair name sha subs="bee-cli elthur"

  if [ -d "$BEE_DIR" ]; then
    out="$(docker run --rm --platform "$platform" -v "$BEE_DIR:/root/.bee" "$IMAGE:$TAG" status 2>&1 || true)"
  else
    out="$(docker run --rm --platform "$platform" "$IMAGE:$TAG" version 2>&1 || true)"
    subs="bee-cli"
  fi

  log "baked revisions ($platform, checking: $subs)"
  for pair in "bee-cli:$(recorded_sha bee-cli)" "elthur:$(recorded_sha elthur)"; do
    name="${pair%%:*}"
    sha="${pair#*:}"
    case " $subs " in
      *" $name "*) ;;
      *) continue ;;
    esac
    case "$out" in
      *"$sha"*) printf '  %-8s %s MATCH\n' "$name" "${sha:0:12}" | tee -a "$LOG" ;;
      *) printf '  %-8s %s MISMATCH\n' "$name" "${sha:0:12}" | tee -a "$LOG"; ok=0 ;;
    esac
  done
  if [ "$ok" != "1" ]; then
    echo "baked revisions do not match the gitlinks recorded in HEAD" | tee -a "$LOG"
    return 1
  fi
}

cmd_audit() {
  local platform="${1:-$VERIFY_PLATFORM}"
  local secret=""
  if [ -f "$BEE_DIR/token-prod" ]; then
    secret="$(tr -d '[:space:]' < "$BEE_DIR/token-prod" | cut -c1-24)"
  fi
  log "audit $platform: image config env"
  docker image inspect "$IMAGE:$TAG" --format '{{json .Config.Env}}' | tee -a "$LOG"
  log "audit $platform: credentials must be absent from the image"
  run_logged docker run --rm --platform "$platform" -e QUEEN_AUDIT_SECRET="$secret" \
    --entrypoint sh "$IMAGE:$TAG" -c '
      bad=""
      if [ -e /root/.bee ]; then bad="$bad /root/.bee"; fi
      junk=$(find / -xdev \( -name "token-*" -o -name ".bee" -o -name ".netrc" -o -name "auth.json" \) 2>/dev/null || true)
      if [ -n "$junk" ]; then bad="$bad $junk"; fi
      if [ -n "$QUEEN_AUDIT_SECRET" ]; then
        hits=$(grep -rl --binary-files=text "$QUEEN_AUDIT_SECRET" /usr/local /root /etc /data /tmp /var 2>/dev/null || true)
        if [ -n "$hits" ]; then bad="$bad token-in:$hits"; fi
      fi
      if [ -n "$bad" ]; then echo "DIRTY:$bad"; exit 1; fi
      echo "clean: no credentials in image"
    '
}

cmd_verify() {
  cmd_pull "$VERIFY_PLATFORM"
  log "uname"
  run_logged docker run --rm --platform "$VERIFY_PLATFORM" --entrypoint uname "$IMAGE:$TAG" -m
  log "version"
  with_creds "$VERIFY_PLATFORM" version
  log "status"
  with_creds "$VERIFY_PLATFORM" status
  cmd_shas "$VERIFY_PLATFORM"
  cmd_audit "$VERIFY_PLATFORM"
}

cmd_amd64() {
  cmd_pull linux/amd64
  log "uname"
  run_logged docker run --rm --platform linux/amd64 --entrypoint uname "$IMAGE:$TAG" -m
  log "version"
  with_creds linux/amd64 version
  log "status"
  with_creds linux/amd64 status
  cmd_shas linux/amd64
  cmd_audit linux/amd64
}

cmd_tui() {
  log "tui $VERIFY_PLATFORM (bee dir $BEE_DIR)"
  docker run --rm -it --platform "$VERIFY_PLATFORM" -v "$BEE_DIR:/root/.bee" "$IMAGE:$TAG"
}

cmd_status() {
  log "manifest $IMAGE:$TAG"
  run_logged docker buildx imagetools inspect "$IMAGE:$TAG"
}

cmd_stop() {
  docker buildx rm "$BUILDER" >/dev/null 2>&1 || true
  colima stop || true
}

cmd_clean() {
  docker buildx rm "$BUILDER" >/dev/null 2>&1 || true
  colima delete -f
  rm -rf "$HOME/.colima/_lima/_disks/${QUEEN_COLIMA_PROFILE:-default}"
  log "clean: colima deleted, datadisk leftovers removed"
}

cmd_all() {
  cmd_build
  cmd_verify
  cmd_stop
}

case "${1:-}" in
  build) cmd_build ;;
  monitor) cmd_monitor ;;
  verify) cmd_verify ;;
  amd64) cmd_amd64 ;;
  tui) cmd_tui ;;
  audit) cmd_audit ;;
  shas) cmd_shas ;;
  status) cmd_status ;;
  stop) cmd_stop ;;
  clean) cmd_clean ;;
  all) cmd_all ;;
  *) usage ;;
esac
