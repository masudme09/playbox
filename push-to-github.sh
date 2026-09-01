#!/usr/bin/env bash
# =============================================================
#  Run this ONCE, in your own macOS Terminal, from this folder:
#
#      cd ~/CascadeProjects/playbox && ./push-to-github.sh
#
#  It uses the GitHub login already on this Mac. Nothing here
#  stores or prints a credential.
# =============================================================
set -euo pipefail
cd "$(dirname "$0")"

REPO_NAME="playbox"
VISIBILITY="private"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m   %s\n' "$*"; }
warn() { printf '  \033[33mwarn\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mstopped:\033[0m %s\n\n' "$*" >&2; exit 1; }

say "1. Checks"

command -v git >/dev/null || die "git is not installed."
ok "git $(git --version | awk '{print $3}')"

NAME=$(git config --get user.name  || true)
MAIL=$(git config --get user.email || true)
if [ -z "$NAME" ] || [ -z "$MAIL" ]; then
  die "git has no identity set, so the commit would be attributed to nobody. Run:
    git config --global user.name  \"Your Name\"
    git config --global user.email \"you@example.com\"
  then run this script again."
fi
ok "commits will be authored by $NAME <$MAIL>"

if [ -d .git ]; then
  die "this folder is already a git repository. Nothing was changed.
  If you meant to start over:  rm -rf .git  and re-run."
fi

USE_GH=0
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  USE_GH=1
  ok "gh is installed and logged in as $(gh api user --jq .login 2>/dev/null || echo '?')"
else
  warn "gh is not installed or not logged in — I will not be able to create the repo for you."
fi

say "2. First commit"

git init -q -b main
git add -A
git -c core.hooksPath=/dev/null commit -q -m "Playbox: five games in one Android app, with CI/CD

One Capacitor app containing Echo, Starfall, Prism, Vortex and Daily Lock,
behind a hub with a daily challenge, streaks and cross-game tokens.

- shared/registry.js is the extension point: a new game is one entry
- five test suites (hub, profile, ad bridge, listings, pre-flight)
- GitHub Actions: tests on every push, internal track on main,
  production draft on a version tag, Pages for the privacy policy
- real ad IDs come from repo secrets, never from the tree"
ok "$(git rev-list --count HEAD) commit, $(git ls-files | wc -l | tr -d ' ') files"

say "3. GitHub"

if [ "$USE_GH" = "1" ]; then
  if gh repo view "$REPO_NAME" >/dev/null 2>&1; then
    OWNER=$(gh api user --jq .login)
    warn "$OWNER/$REPO_NAME already exists — pushing to it as a new main branch."
    git remote add origin "$(gh repo view "$REPO_NAME" --json sshUrl --jq .sshUrl)"
    git push -u origin main
  else
    gh repo create "$REPO_NAME" --"$VISIBILITY" --source=. --remote=origin --push
  fi
  URL=$(gh repo view --json url --jq .url)
  ok "pushed to $URL"
else
  cat <<'MANUAL'

  Create an empty PRIVATE repo called "playbox" on github.com — do NOT add a
  README, .gitignore or licence, or the first push will be rejected.
  Then run, with YOUR username:

      git remote add origin git@github.com:YOUR-USERNAME/playbox.git
      git push -u origin main

MANUAL
  exit 0
fi

say "4. Tidy up"
if [ -f ../playbox-transfer.zip ]; then
  rm -f ../playbox-transfer.zip
  ok "removed the transfer archive (~/CascadeProjects/playbox-transfer.zip)"
fi

say "Done. Two things to do on github.com:"
cat <<NEXT

  a) Settings -> Pages -> Source: GitHub Actions
     Then run the Pages workflow. It publishes your privacy policy at
     <pages-url>/privacy.html — the URL Play requires — and a playable
     build of the game at <pages-url>/play/

  b) Settings -> Secrets and variables -> Actions
     Add secrets as you get them. The full table, and how to obtain each
     one, is in .github/RELEASING.md

  Heads up: this push triggers two workflows. CI runs the five test suites
  (~5 min). Release also runs, because you pushed to main — it will build
  the app, then stop with a warning that there is no signing secret yet and
  attach an unsigned .aab as an artifact. That warning is expected.

NEXT
