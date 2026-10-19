#!/usr/bin/env bash

set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
server_dist="$repo_root/apps/server/dist"
port="${PORT:-3773}"
host="${HOST:-0.0.0.0}"
base_dir="${T3CODE_HOME:-${HOME}/.t3}"
rebuild=false
server_args=()

usage() {
  cat <<'EOF'
Usage: ./start.sh [options] [T3 server options]

Build the v2 web/server JavaScript bundle in Docker, then run it with the
native dependencies installed from this checkout's pinned lockfile.

Options:
  --port PORT       Server port (default: $PORT or 3773)
  --host HOST       Bind address (default: $HOST or 0.0.0.0)
  --base-dir PATH   T3 home (default: $T3CODE_HOME or ~/.t3)
  --rebuild         Rebuild the production bundle inside Docker
  -h, --help        Show this help

Other options are forwarded to the T3 server, such as --no-browser.
The first run needs Docker, Node 24.13.1 or later in the 24.x series, and
pnpm 11.10.0. The server runs against the specified T3 home.
EOF
}

die() {
  printf 'start.sh: %s\n' "$*" >&2
  exit 1
}

require_value() {
  [[ -n "${2:-}" ]] || die "$1 requires a value"
}

while (($# > 0)); do
  case "$1" in
    --port|--host|--base-dir)
      require_value "$1" "${2:-}"
      case "$1" in
        --port) port="$2" ;;
        --host) host="$2" ;;
        --base-dir) base_dir="$2" ;;
      esac
      shift 2
      ;;
    --port=*|--host=*|--base-dir=*)
      option="${1%%=*}"
      value="${1#*=}"
      require_value "$option" "$value"
      case "$option" in
        --port) port="$value" ;;
        --host) host="$value" ;;
        --base-dir) base_dir="$value" ;;
      esac
      shift
      ;;
    --rebuild) rebuild=true; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; server_args+=("$@"); break ;;
    *) server_args+=("$1"); shift ;;
  esac
done

[[ "$port" =~ ^[0-9]+$ ]] || die "port must be an integer between 1 and 65535"
((port >= 1 && port <= 65535)) || die "port must be an integer between 1 and 65535"
[[ -n "$host" ]] || die "host must not be empty"
[[ -n "$base_dir" ]] || die "base directory must not be empty"

command -v node >/dev/null 2>&1 || die "Node.js is required"
node -e 'const [major, minor, patch] = process.versions.node.split(".").map(Number); process.exit(major === 24 && (minor > 13 || (minor === 13 && patch >= 1)) ? 0 : 1)' || die "Node 24.13.1 or later in the 24.x series is required"
command -v pnpm >/dev/null 2>&1 || die "pnpm is required"
[[ "$(pnpm --version)" == 11.10.0 ]] || die "pnpm 11.10.0 is required by this checkout"

if [[ "$rebuild" == true || ! -f "$server_dist/bin.mjs" || ! -f "$server_dist/client/index.html" ]]; then
  command -v docker >/dev/null 2>&1 || die "Docker is required to build the production bundle"
  docker info >/dev/null 2>&1 || die "Docker is installed but is not running"
  mkdir -p "$repo_root/tmp"
  output_dir="$(mktemp -d "$repo_root/tmp/local-release-build.XXXXXX")"
  printf 'Building the v2 production bundle inside Docker...\n'
  docker build --progress=plain --file "$repo_root/Dockerfile.local-release" \
    --output "type=local,dest=$output_dir" "$repo_root" || die "Docker build failed; output retained at $output_dir"
  [[ -f "$output_dir/bin.mjs" && -f "$output_dir/client/index.html" ]] || die "Docker build did not produce a complete server bundle"
  mkdir -p "$(dirname "$server_dist")"
  if [[ -d "$server_dist" ]]; then
    backup_dir="$(mktemp -d "$repo_root/tmp/local-release-previous.XXXXXX")"
    rmdir "$backup_dir"
    mv "$server_dist" "$backup_dir"
    printf 'Previous bundle retained at %s\n' "$backup_dir"
  else
    backup_dir=""
  fi
  if ! mv "$output_dir" "$server_dist"; then
    [[ -z "$backup_dir" ]] || mv "$backup_dir" "$server_dist"
    die "Could not activate the Docker build"
  fi
fi

printf 'Installing the matching native runtime dependencies from pnpm-lock.yaml...\n'
(cd "$repo_root" && pnpm install --frozen-lockfile --filter=t3...)

printf 'State directory: %s/userdata\n' "$base_dir"
printf 'URL: http://%s:%s\n' "$host" "$port"
exec node "$server_dist/bin.mjs" \
  --port "$port" \
  --host "$host" \
  --base-dir "$base_dir" \
  --log-level error \
  "${server_args[@]}"
