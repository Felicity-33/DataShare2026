@echo off
rem DataShare one-click launcher (ASCII only to avoid Windows codepage garbling)
cd /d "%~dp0"
node start.mjs
echo.
echo Process exited. Press any key to close this window.
pause >nul
