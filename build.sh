#!/bin/zsh
# Собирает YTShot с подписью и ставит в ~/Applications,
# чтобы Safari подхватил новую версию расширения.
set -euo pipefail

ROOT="${0:A:h}"
DERIVED="${TMPDIR:-/tmp}/ytshot-build"
LOG="$DERIVED/build.log"
APP_NAME="YTShot.app"
DEST="$HOME/Applications/$APP_NAME"

mkdir -p "$DERIVED"

# Атрибуты Finder/iCloud на файлах ломают codesign ("resource fork ... not allowed").
xattr -cr "$ROOT/Extension" "$ROOT/YTShot/YTShot"

echo "▸ Сборка…"
if ! xcodebuild \
  -project "$ROOT/YTShot/YTShot.xcodeproj" \
  -scheme YTShot \
  -configuration Release \
  -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates \
  build >"$LOG" 2>&1; then
  grep -E "error:|failed" "$LOG" | head -20
  echo "✗ Сборка не удалась, полный лог: $LOG"
  exit 1
fi

BUILT="$DERIVED/Build/Products/Release/$APP_NAME"
codesign --verify --deep --strict "$BUILT"

echo "▸ Установка в $DEST"
osascript -e 'quit app "YTShot"' 2>/dev/null || true
mkdir -p "$HOME/Applications"
rm -rf "$DEST"
ditto "$BUILT" "$DEST"

# Иначе macOS видит вторую копию приложения во временной папке сборки.
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
"$LSREGISTER" -u "$BUILT" 2>/dev/null || true
rm -rf "$BUILT"
"$LSREGISTER" -f "$DEST"
# Регистрируем расширение в Safari без запуска приложения: оно не нужно в фоне.
pluginkit -a "$DEST/Contents/PlugIns/YTShot Extension.appex"

SIGNER=$(codesign -dvv "$DEST" 2>&1 | sed -n 's/^Authority=//p' | head -1)
echo "✓ Готово (подпись: ${SIGNER:-ad-hoc}). Если окошко YTShot было открыто, откройте его заново."
