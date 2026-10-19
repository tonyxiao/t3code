#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--help" ]]; then
  echo "Usage: scripts/build-and-install-tony-mac.sh [--help]"
  exit 0
fi
if [[ $# -ne 0 ]]; then
  echo "Usage: scripts/build-and-install-tony-mac.sh [--help]" >&2
  exit 2
fi
if [[ $(uname -s) != Darwin ]]; then
  echo "A macOS host is required." >&2
  exit 1
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$repo_root"
if [[ -x /opt/homebrew/opt/node@24/bin/node ]]; then
  export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
fi
if [[ $(node -p 'process.versions.node.split(".")[0]') != 24 ]]; then
  echo "Node 24 is required." >&2
  exit 1
fi
if [[ ! -x node_modules/.bin/vp ]]; then
  echo "Install workspace dependencies before building." >&2
  exit 1
fi

case $(uname -m) in
  arm64) build_arch=arm64 ;;
  x86_64) build_arch=x64 ;;
  *) echo "Unsupported Mac architecture." >&2; exit 1 ;;
esac

app_name='Tony T3 Code (Alpha).app'
install_dir="$HOME/Applications"
destination="$install_dir/$app_name"
if [[ -d "$destination" ]] && lsof -t "$destination/Contents/MacOS/${app_name%.app}" >/dev/null 2>&1; then
  echo "Quit $app_name before replacing it." >&2
  exit 1
fi

build_dir="$repo_root/tmp/tony-local-macos"
mkdir -p "$build_dir" "$install_dir"
T3CODE_DESKTOP_TONY_BUILD=1 \
T3CODE_DESKTOP_UPDATE_URL=https://cs-mini.meteor-ruffe.ts.net/t3-downloads/macos/ \
node scripts/build-desktop-artifact.ts \
  --platform mac --target dmg --arch "$build_arch" --output-dir "$build_dir"

version=$(node -p 'require("./apps/server/package.json").version')
archive="$build_dir/T3-Code-$version-$build_arch.zip"
if [[ ! -f "$archive" ]]; then
  echo "The build did not produce $archive." >&2
  exit 1
fi
stage=$(mktemp -d "$repo_root/tmp/tony-local-install.XXXXXXXX")
ditto -x -k "$archive" "$stage"
app="$stage/$app_name"
if [[ ! -f "$app/Contents/Resources/app.asar" ]]; then
  echo "The archive does not contain a packaged $app_name." >&2
  exit 1
fi
bundle_id=$(plutil -extract CFBundleIdentifier raw "$app/Contents/Info.plist")
built_version=$(plutil -extract CFBundleShortVersionString raw "$app/Contents/Info.plist")
if [[ "$bundle_id" != com.tonyxiao.t3code.desktop || "$built_version" != "$version" ]]; then
  echo "The built app has an unexpected identity or version." >&2
  exit 1
fi

incoming="$install_dir/.tony-t3-code-incoming-$$.app"
ditto "$app" "$incoming"
source_hash=$(shasum -a 256 "$app/Contents/Resources/app.asar" | awk '{print $1}')
copied_hash=$(shasum -a 256 "$incoming/Contents/Resources/app.asar" | awk '{print $1}')
if [[ "$source_hash" != "$copied_hash" ]]; then
  echo "The copied app does not match the build." >&2
  exit 1
fi
if [[ -d "$destination" ]] && lsof -t "$destination/Contents/MacOS/${app_name%.app}" >/dev/null 2>&1; then
  echo "The installed app started during the build; quit it and retry." >&2
  exit 1
fi
backup=''
if [[ -e "$destination" ]]; then
  backup="$install_dir/Tony T3 Code (Alpha) Backup $(date +%Y%m%d-%H%M%S)-$$.app"
  mv "$destination" "$backup"
  echo "Previous app saved as $backup"
fi
if ! mv "$incoming" "$destination"; then
  if [[ -n "$backup" ]]; then mv "$backup" "$destination"; fi
  exit 1
fi
echo "Installed $destination ($built_version, $build_arch)"
