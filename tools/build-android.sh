#!/usr/bin/env bash
# =============================================================
#  Assemble Playbox into a ready-to-open Android Studio project.
#
#    ./tools/build-android.sh
#
#  Needs Node 18+, and Android Studio with the SDK to produce an
#  .aab. Run from the repo root. Safe to re-run: the second run
#  syncs the existing project instead of recreating it.
# =============================================================
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

CAP_VER="^8.0.0"
ADMOB_VER="^8.0.0"
P="$ROOT/build"

read_cfg() { node -e "
  const c = require('$ROOT/app.config.json');
  console.log([c.appId, c.storeName || c.appName, c.appName, c.versionName, c.versionCode,
               c.admobAppId || 'ca-app-pub-3940256099942544~3347511713'].join('\t'));
"; }
IFS=$'\t' read -r APPID STORENAME APPNAME VNAME VCODE ADMOBAPPID < <(read_cfg)

# CI overrides. versionCode has to increase on every upload or Play rejects the
# bundle, so the pipeline derives it from the run number rather than trusting a
# human to remember. The AdMob app id comes from a secret so a public repo need
# not carry it.
[ -n "${PLAYBOX_VERSION_CODE:-}" ] && VCODE="$PLAYBOX_VERSION_CODE"
[ -n "${PLAYBOX_ADMOB_APP_ID:-}" ] && ADMOBAPPID="$PLAYBOX_ADMOB_APP_ID"

echo ""
echo "=============================================================="
echo " $STORENAME"
echo " $APPID   v$VNAME (code $VCODE)"
echo "=============================================================="

mkdir -p "$P"

# ---- 1. web assets -------------------------------------------------
# The repo layout already matches the deployed layout, so this is a
# verbatim copy — no path rewriting, nothing to get out of step.
rm -rf "$P/www"
mkdir -p "$P/www"
cp "$ROOT/index.html" "$P/www/"
cp -r "$ROOT/hub"     "$P/www/"
cp -r "$ROOT/shared"  "$P/www/"
cp -r "$ROOT/games"   "$P/www/"
rm -f "$P/www/shared/CONTRACT.md"
# real ad IDs, if this build has them, go into the copy under build/ only
node "$ROOT/tools/inject-ads.mjs" "$P/www/shared/ad-config.js"
GAMES=$(node -e "
  const fs=require('fs');
  const src=fs.readFileSync('$ROOT/shared/registry.js','utf8');
  console.log((src.match(/slug: '/g)||[]).length);
")
echo "   www/ assembled — $GAMES games, $(find "$P/www" -type f | wc -l | tr -d ' ') files, $(du -sh "$P/www" | cut -f1)"

# ---- 2. project manifest ------------------------------------------
cat > "$P/package.json" <<JSON
{
  "name": "playbox",
  "version": "$VNAME",
  "private": true,
  "description": "$STORENAME",
  "scripts": {
    "sync": "cap sync android",
    "open": "cap open android"
  },
  "dependencies": {
    "@capacitor/android": "$CAP_VER",
    "@capacitor/core": "$CAP_VER",
    "@capacitor-community/admob": "$ADMOB_VER"
  },
  "devDependencies": {
    "@capacitor/cli": "$CAP_VER"
  }
}
JSON

cat > "$P/capacitor.config.json" <<JSON
{
  "appId": "$APPID",
  "appName": "$APPNAME",
  "webDir": "www",
  "android": {
    "allowMixedContent": false,
    "captureInput": true,
    "webContentsDebuggingEnabled": false
  },
  "server": {
    "androidScheme": "https"
  }
}
JSON

# ---- 3. dependencies ----------------------------------------------
echo "   installing Capacitor + AdMob..."
(cd "$P" && npm install --silent --no-audit --no-fund)

# ---- 4. android platform ------------------------------------------
if [ -d "$P/android" ]; then
  (cd "$P" && npx --no-install cap sync android >/dev/null)
  echo "   android/ synced"
else
  (cd "$P" && npx --no-install cap add android >/dev/null)
  echo "   android/ created"
fi

# ---- 5. all the Android-side edits --------------------------------
node "$ROOT/tools/patch-android.mjs" "$P" playbox "$STORENAME" "$APPID" "$VNAME" "$VCODE" "$ADMOBAPPID"

# ---- 6. store material next to the project -------------------------
mkdir -p "$P/store"
cp -r "$ROOT/store-assets/playbox/"* "$P/store/" 2>/dev/null || true
cp "$ROOT/store-listings/playbox.md" "$P/store/listing.md" 2>/dev/null || true
cp "$ROOT/legal/playbox-privacy.html" "$P/store/privacy.html" 2>/dev/null || true

cat <<DONE

   ready:  build/android   ->  open this folder in Android Studio

--------------------------------------------------------------
Next:
  1. Open build/android in Android Studio and let Gradle sync.
  2. Run it on a device. You will see Google's TEST ads — correct.
  3. To go live, edit two files in THIS repo (never in build/, which is
     regenerated every run):
       shared/ad-config.js   ->  your three real ad unit IDs, useTestAds:false
       app.config.json       ->  admobAppId, your real ca-app-pub-XXXX~YYYY
     then re-run this script
  4. Build > Generate Signed App Bundle  ->  upload the .aab

To add a game in a later update:
  node tools/new-game.mjs <slug> "Name"      # scaffolds it
  ...build the game, then add its registry entry
  bump versionCode + versionName in app.config.json
  ./tools/build-android.sh
See PUBLISHING-GUIDE.md.
--------------------------------------------------------------
DONE
