#!/bin/sh
# Double-click (Mac) or run `sh update.command` to update this folder to the latest version
# from GitHub. The repo is private, so the first run asks you to sign in to GitHub.
cd "$(dirname "$0")" || exit 1
REPO=https://github.com/ultimatewizard1/fantasy-basketball-test.git
BRANCH=claude/gifted-newton-30bdl7

finish() { echo; printf 'Press Enter to close. '; read -r _; exit "$1"; }
failed() {
  echo
  echo "Update failed. If GitHub asked you to sign in, use the account that has access to"
  echo "ultimatewizard1/fantasy-basketball-test (a personal access token as the password), then try again."
  finish 1
}

if ! command -v git >/dev/null 2>&1; then
  echo "Git isn't installed. On a Mac, run  xcode-select --install  in Terminal (or install"
  echo "GitHub Desktop), then run this again."
  finish 1
fi

if [ ! -d .git ]; then
  echo "This folder came from a ZIP. Connecting it to GitHub so future updates are one click..."
  git init -q && git remote add origin "$REPO" || failed
  git fetch origin "$BRANCH" || failed
  # Replaces the ZIP's files with the latest version. Your settings live in the browser, not here.
  git checkout -q -f -B "$BRANCH" "origin/$BRANCH" || failed
  git branch -q --set-upstream-to="origin/$BRANCH" || failed
elif ! git pull --ff-only; then
  echo
  echo "Files in this folder were changed locally, so the update couldn't apply cleanly."
  printf 'Discard local changes and take the latest version? [y/N] '
  read -r answer
  case "$answer" in [yY]*) ;; *) finish 1 ;; esac
  git fetch origin && git reset -q --hard '@{u}' || failed
fi

echo
echo "Up to date:"
git log -1 --format='  %h  %cd  %s' --date=format:'%Y-%m-%d %H:%M'
echo "Reload the tool in your browser to use it."
finish 0
