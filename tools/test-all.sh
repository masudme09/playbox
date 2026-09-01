#!/usr/bin/env bash
# Everything that must be green before an upload.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
run() {
  echo ""
  echo "=============================================================="
  echo " $1"
  echo "=============================================================="
  shift
  if "$@"; then echo "  -> PASS"; else echo "  -> FAIL"; fail=1; fi
}
run "listing copy vs Play's character limits" node tools/check-listings.mjs
run "ad bridge vs a mock of the native AdMob plugin" node tools/test-ads.mjs
run "profile: daily challenge, streaks, tokens, clock abuse" node tools/test-profile.mjs
run "hub: navigation, shelf, shop, stats, teardown" node tools/test-hub.mjs
run "pre-flight: assets, registry, android project, runtime" node tools/verify.mjs
echo ""
if [ $fail -eq 0 ]; then echo "ALL SUITES PASSED"; else echo "SOMETHING FAILED — do not upload"; fi
exit $fail
