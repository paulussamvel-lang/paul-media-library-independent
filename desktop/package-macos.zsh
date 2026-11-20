#!/bin/zsh
set -eu

project=${0:A:h:h}
output=${1:-"$project/dist/macos"}
app_name='Paul 素材库'
app_id='local.paul.material-library'
electron="$project/desktop/node_modules/electron/dist/Electron.app"
node_bin="$(command -v node)"

[[ "$(uname -s)" == Darwin && -d "$electron" && -d "$project/backend/node_modules" ]]
[[ "$("$node_bin" -p 'process.platform + ":" + process.arch + ":" + process.versions.node.split(".")[0]')" == "darwin:$(uname -m):26" ]]
if [[ -e "$output/$app_name.app" ]]; then
  printf '输出位置已存在，请指定新的输出目录。\n' >&2
  exit 1
fi

npm --prefix "$project/frontend" run build
mkdir -p "$output"
staging="$(mktemp -d "$output/.paul-build.XXXXXX")"
trap '[[ -d $staging ]] && rm -rf -- "$staging"' EXIT
bundle="$staging/$app_name.app"
/usr/bin/ditto "$electron" "$bundle"

contents="$bundle/Contents"
resources="$contents/Resources"
runtime="$resources/app"
mkdir -p "$runtime/desktop" "$runtime/backend" "$runtime/frontend"
cp "$project/desktop/main.js" "$project/desktop/preload.js" "$runtime/desktop/"
cp "$project"/backend/*.js "$runtime/backend/"
/usr/bin/ditto "$project/backend/providers" "$runtime/backend/providers"
/usr/bin/ditto "$project/backend/node_modules" "$runtime/backend/node_modules"
/usr/bin/ditto "$project/frontend/dist" "$runtime/frontend/dist"
/usr/bin/ditto "$project/chrome-extension" "$runtime/chrome-extension"
install -m 755 "$node_bin" "$contents/MacOS/node"

"$node_bin" - "$project/desktop/package.json" "$runtime/package.json" <<'NODE'
const fs = require('node:fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { name, version } = manifest;
fs.writeFileSync(process.argv[3], JSON.stringify({ name, version, productName: 'Paul 素材库', main: 'desktop/main.js' }));
NODE

plist=/usr/libexec/PlistBuddy
version="$("$node_bin" -p 'require(process.argv[1]).version' "$runtime/package.json")"

set_plist() {
  "$plist" -c "Set :$2 $3" "$1" 2>/dev/null || "$plist" -c "Add :$2 string $3" "$1"
}

info="$contents/Info.plist"
set_plist "$info" CFBundleIdentifier "$app_id"
set_plist "$info" CFBundleDisplayName "$app_name"
set_plist "$info" CFBundleName "$app_name"
set_plist "$info" CFBundleShortVersionString "$version"
set_plist "$info" CFBundleVersion "$version"
if [[ -f "$project/desktop/PaulLibrary.icns" ]]; then
  cp "$project/desktop/PaulLibrary.icns" "$resources/"
  set_plist "$info" CFBundleIconFile PaulLibrary.icns
fi

frameworks="$contents/Frameworks"
while IFS= read -r -d '' executable; do
  /usr/bin/codesign --force --sign - --preserve-metadata=entitlements "$executable"
done < <(find "$frameworks" -type f \( -name '*.dylib' -o -name chrome_crashpad_handler -o -name ShipIt \) -print0)
for framework in "$frameworks"/*.framework; do
  /usr/bin/codesign --force --sign - --preserve-metadata=entitlements "$framework"
done
for helper in "$frameworks"/*.app; do
  info="$helper/Contents/Info.plist"
  vendor_id="$("$plist" -c 'Print :CFBundleIdentifier' "$info")"
  helper_name="${helper:t:r}"
  set_plist "$info" CFBundleIdentifier "${vendor_id/#com.github.Electron/$app_id}"
  set_plist "$info" CFBundleDisplayName "${helper_name/Electron/$app_name}"
  set_plist "$info" CFBundleName "${helper_name/Electron/$app_name}"
  /usr/bin/codesign --force --sign - --preserve-metadata=entitlements "$helper"
done

/usr/bin/codesign --force --sign - "$contents/MacOS/node"
/usr/bin/codesign --force --sign - --preserve-metadata=entitlements "$bundle"
/usr/bin/codesign --verify --deep --strict "$bundle"
mv "$bundle" "$output/$app_name.app"
printf '%s\n' "$output/$app_name.app"
