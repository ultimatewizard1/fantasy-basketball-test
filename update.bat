@echo off
rem Double-click to update this folder to the latest version from GitHub.
rem Needs Git for Windows (https://git-scm.com/download/win). The repo is private,
rem so the first run opens a GitHub sign-in window.
setlocal EnableDelayedExpansion
cd /d "%~dp0"
set "REPO=https://github.com/ultimatewizard1/fantasy-basketball-test.git"
set "BRANCH=main"

where git >nul 2>nul
if errorlevel 1 (
  echo Git isn't installed.
  echo Install it from https://git-scm.com/download/win ^(default options are fine^),
  echo then double-click update.bat again.
  goto done
)

if not exist ".git" (
  echo This folder came from a ZIP. Connecting it to GitHub so future updates are one click...
  git init -q
  git remote add origin "%REPO%"
  git fetch origin "%BRANCH%" || goto failed
  rem Replaces the ZIP's files with the latest version. Your settings live in the browser, not here.
  git checkout -q -f -B "%BRANCH%" "origin/%BRANCH%" || goto failed
  git branch -q --set-upstream-to="origin/%BRANCH%" || goto failed
  goto updated
)

rem Copies set up from an older branch move to main.
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "CUR=%%b"
if /i not "!CUR!"=="%BRANCH%" goto switch

git pull --ff-only
if errorlevel 1 (
  echo.
  echo Files in this folder were changed locally, so the update couldn't apply cleanly.
  set /p ANSWER="Discard local changes and take the latest version? [y/N] "
  if /i not "!ANSWER!"=="y" goto done
  git fetch origin || goto failed
  git reset -q --hard "@{u}" || goto failed
)

goto updated

:switch
echo Switching this folder to the %BRANCH% branch...
git fetch origin "%BRANCH%" || goto failed
git diff --quiet HEAD
if errorlevel 1 (
  set /p ANSWER="Files in this folder were changed locally. Discard them and take the latest version? [y/N] "
  if /i not "!ANSWER!"=="y" goto done
)
git checkout -q -f -B "%BRANCH%" "origin/%BRANCH%" || goto failed
git branch -q --set-upstream-to="origin/%BRANCH%" || goto failed

:updated
echo.
echo Up to date:
git log -1 --format="  %%h  %%cd  %%s" --date=format:"%%Y-%%m-%%d %%H:%%M"
echo Reload the tool in your browser (Ctrl+F5) to use it.
goto done

:failed
echo.
echo Update failed. If GitHub asked you to sign in, make sure you used the account
echo that has access to ultimatewizard1/fantasy-basketball-test, then try again.

:done
echo.
pause
