#!/usr/bin/env bash
# Builds the installable package for the MintHRM Attendance Automation System.
#
#   ./scripts/build.sh
#
# Output (in dist/):
#   minthrm-attendance-automation-v<version>.zip   versioned package
#   minthrm-attendance-automation.zip              same file, stable name for "latest" links
#   SHA256SUMS.txt                                 checksums for both
#
# The zip contains one folder, "minthrm-attendance-automation/", ready for
# chrome://extensions → Load unpacked. The same zip can be uploaded to the
# Chrome Web Store / Edge Add-ons dashboard as-is.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NAME="minthrm-attendance-automation"
FILES=(manifest.json content.js popup.html popup.js icons/icon16.png icons/icon48.png icons/icon128.png README.txt)

command -v zip  >/dev/null || { echo "error: 'zip' is not installed" >&2; exit 1; }
command -v node >/dev/null || { echo "error: Node.js is required for validation" >&2; exit 1; }

node scripts/validate.mjs

VERSION="$(node -p "require('./manifest.json').version")"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/$NAME"
for f in "${FILES[@]}"; do
  mkdir -p "$STAGE/$NAME/$(dirname "$f")"
  cp "$f" "$STAGE/$NAME/$f"
done

mkdir -p dist
OUT="dist/${NAME}-v${VERSION}.zip"
rm -f "$OUT" "dist/${NAME}.zip" dist/SHA256SUMS.txt
# Fixed timestamps + -X (no extra attributes) → byte-identical zips for identical sources
(cd "$STAGE" && TZ=UTC find "$NAME" -exec touch -d '2000-01-01T00:00:00Z' {} + && zip -q -r -X "$ROOT/$OUT" "$NAME")
cp "$OUT" "dist/${NAME}.zip"
(cd dist && sha256sum "${NAME}-v${VERSION}.zip" "${NAME}.zip" > SHA256SUMS.txt)

echo
echo "Package built:"
unzip -l "$OUT" | sed 's/^/  /'
echo
cat dist/SHA256SUMS.txt
