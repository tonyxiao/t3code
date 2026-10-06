#!/usr/bin/env bash
set -euo pipefail

if [[ $(uname -s) != Darwin ]]; then
  echo "This build requires macOS." >&2
  exit 1
fi

cd "$(dirname "$0")/.."

if ! command -v cargo >/dev/null 2>&1 && command -v rustup >/dev/null 2>&1; then
  export PATH="$(dirname "$(rustup which cargo)"):$PATH"
fi

app_name=$(node -p 'require("./apps/desktop/package.json").productName')
app_path="build/$app_name.app"
if [[ -d "$app_path" ]] && lsof -t "$app_path/Contents/MacOS/$app_name" >/dev/null 2>&1; then
  echo "Quit $app_name before replacing $app_path." >&2
  exit 1
fi

node scripts/build-desktop-artifact.ts --platform mac --target dir --output-dir build
