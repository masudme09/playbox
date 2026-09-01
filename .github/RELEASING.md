# The pipeline

Three workflows. All of them work from your first commit; the ones that need
credentials skip the parts they cannot do and tell you what is missing, rather
than failing.

| Workflow | Runs when | Does |
|---|---|---|
| **CI** (`ci.yml`) | every push and pull request | assembles the app, runs all five test suites, uploads screenshots on failure |
| **Release** (`release.yml`) | push to `main` → **internal** track · tag `v1.2.3` → **production** as a draft · manual → any track | tests, builds a signed `.aab`, uploads to Play |
| **Pages** (`pages.yml`) | changes to `legal/`, `demo/`, the registry or the config | publishes the privacy policy and the playable build |

`versionCode` is set by CI from the run number, so it always increases and Play
can never reject an upload as a duplicate — the single most common release
failure. You set `versionName` in `app.config.json`, and that is what players
see and what the in-app what's-new sheet keys off.

---

## The one thing you must do by hand

**The very first release cannot go through this pipeline.** The Play Developer
API can only add releases to an app that already exists in Play Console and has
had at least one bundle accepted. So for version one:

1. Create the app in Play Console and complete the store listing and every form
   under **App content**.
2. Run the Release workflow manually (Actions → Release → Run workflow) with
   track `internal`. With no Play credentials yet it will still build and attach
   the `.aab` as a downloadable artifact.
3. Download that artifact and upload it to internal testing through Play
   Console yourself.

After that, the pipeline can do every subsequent upload. It is also worth doing
it once by hand anyway — you will see every form Play makes you fill in.

---

## Secrets

Repo → Settings → Secrets and variables → Actions → **Secrets**.

Nothing here is required to run CI. Add them when you have them; each one
unlocks the next part of the pipeline.

| Secret | Unlocks | How to get it |
|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | a signed bundle | see **Signing key** below |
| `ANDROID_KEYSTORE_PASSWORD` | " | the store password you chose |
| `ANDROID_KEY_ALIAS` | " | the alias you chose, e.g. `upload` |
| `ANDROID_KEY_PASSWORD` | " | the key password you chose |
| `PLAY_SERVICE_ACCOUNT_JSON` | uploading to Play | see **Play service account** below |
| `ADMOB_APP_ID` | real ads | AdMob → Settings → App settings. `ca-app-pub-XXXX~YYYY` (a **`~`**) |
| `AD_BANNER_ID` | real ads | AdMob ad unit. `ca-app-pub-XXXX/NNNN` (a **`/`**) |
| `AD_INTERSTITIAL_ID` | real ads | " |
| `AD_REWARDED_ID` | real ads | " |
| `AD_TEST_DEVICE_IDS` | keeping your own phone out of your stats | comma-separated; the ID is printed in logcat on the first ad request |

The three `AD_*_ID` secrets are what switch the build to live ads. Set all
three or none — the build **refuses** a partial set, because a missing slot
would silently keep serving test ads and earn nothing. The committed
`shared/ad-config.js` always keeps Google's test IDs; the real ones are written
only into `build/` at build time, so nothing sensitive ever lands in the repo.

### Variables

Repo → Settings → Secrets and variables → Actions → **Variables**.

| Variable | Default | Meaning |
|---|---|---|
| `VERSION_CODE_OFFSET` | `100` | added to the run number to get `versionCode`. If you have already uploaded a build by hand with a higher code, raise this above it — the code must strictly exceed anything Play has seen. |

---

## Signing key

Make it once. **If you lose it you can never update your own app** — enrol in
Play App Signing (on by default for new apps) so there is a recovery path.

```bash
keytool -genkey -v -keystore upload-keystore.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

Then turn it into a secret:

```bash
base64 -w0 upload-keystore.jks          # Linux
base64 -i upload-keystore.jks | tr -d '\n'   # macOS
```

Paste the output into `ANDROID_KEYSTORE_BASE64`. Keep the `.jks` file itself
somewhere safe and **out of the repo** — `.gitignore` already excludes `*.jks`,
`keystore.properties` and `play-service-account*.json`.

The workflow verifies the decoded keystore with `keytool -list` before it
builds, so a truncated or mis-pasted secret fails immediately with a clear
message instead of at signing time.

---

## Play service account

This is the fiddliest part, and it is a one-time job.

1. **Play Console** → Setup → API access. Follow the link to create or select a
   Google Cloud project and link it.
2. In **Google Cloud Console** for that project: enable the **Google Play
   Android Developer API**.
3. Still in Cloud Console: IAM & Admin → Service Accounts → **Create service
   account**. No Cloud roles are needed.
4. On that service account: Keys → Add key → **Create new key** → JSON.
   Download it.
5. Back in **Play Console** → Users and permissions → **Invite new user**,
   using the service account's email (it ends in
   `.iam.gserviceaccount.com`). Grant it, for this app: **Release to testing
   tracks**, **Release to production**, and **Edit and delete draft apps** as
   needed. App-level permissions are enough; it does not need account-level
   admin.
6. Paste the whole JSON file contents into the `PLAY_SERVICE_ACCOUNT_JSON`
   secret.

Permission changes can take a few minutes to propagate. If the first upload
fails with a permissions error, wait and re-run the workflow before changing
anything.

---

## The everyday flows

**A fix or a tweak.** Push to a branch, open a PR — CI runs. Merge to `main` —
a build lands on the internal track and appears on your phone within minutes.

**A release to players.** Bump `versionName` in `app.config.json`, add a
matching entry to `CHANGELOG` in `shared/registry.js`, merge, then:

```bash
git tag v1.1.0 && git push origin v1.1.0
```

The workflow refuses a tag that disagrees with `versionName`, so the store
notes and the in-app what's-new sheet cannot drift apart. Production lands as a
**draft** — open Play Console and press Publish when you are ready.

**A new game.** Exactly the release flow, with the game added first:

```bash
node tools/new-game.mjs asteroids "Asteroids"
```

then the checklist in the main README. `npm run verify` — which CI runs — fails
if any step is half-done: a game with no shelf emblem, a daily-challenge goal
that reads a field the game never reports, a duplicate shop key, a `since` that
is not a version, a changelog that does not match the app version.

**Release notes.** Generated from `CHANGELOG` in `shared/registry.js` by
`npm run notes`, so the notes in the store and the notes in the app are the same
text. Play caps them at 500 characters per locale and the generator fails rather
than letting the store truncate them silently.

---

## When something fails

| Symptom | Cause | Fix |
|---|---|---|
| `Version code N has already been used` | `VERSION_CODE_OFFSET` is too low for what Play has already seen | raise the variable above the highest code ever uploaded |
| `The caller does not have permission` | service account not invited in Play Console, or permissions still propagating | check step 5 above, wait five minutes, re-run |
| `APK specifies a version code that has already been used` on a *first* API upload | the app has never had a bundle accepted | do the manual first upload described at the top |
| `Package not found` | `appId` in `app.config.json` does not match the app in Play Console | they must be identical, and the app must exist |
| Unsigned bundle warning | no `ANDROID_KEYSTORE_BASE64` | add the four signing secrets |
| CI fails only in `[6] runtime` | a game throws in the real bundle | download the `diagnostics` artifact — it has the screenshots and the assembled `www/` |
| Pages deploy fails with a permissions error | Pages source not set to Actions | repo Settings → Pages → Source: **GitHub Actions** |
| `useTestAds:false but only 1/3 ad unit IDs` | one of the three `AD_*_ID` secrets is missing or misnamed | set all three, or remove them all to build with test ads |

---

## What the pipeline deliberately does not do

- **It does not publish to production without you.** A tag uploads a draft;
  a person presses Publish. Play review takes days and a bad release is slow to
  undo.
- **It does not run a staged rollout for you.** Do that in Play Console, where
  you can watch the crash rate and halt it.
- **It does not bump `versionName`.** That is an editorial decision tied to the
  changelog and the what's-new sheet, not something to derive from a commit
  count.
- **It does not commit anything back to the repo.** No version bump commits, no
  generated files. What is in git is what you wrote.

## Sources

- [Google Play Developer API — Edits](https://developers.google.com/android-publisher/edits)
- [r0adkll/upload-google-play](https://github.com/r0adkll/upload-google-play)
- [Play Console — publishing issues](https://support.google.com/googleplay/android-developer/answer/9061737)
