@echo off
setlocal
cd /d "%~dp0"
title EHLIYET Denetci - prova (cevrimdisi)
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kurun.
  pause
  exit /b 1
)
if not exist "node_modules\tsx\dist\cli.mjs" (
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 4; Start-Process 'http://localhost:4747'"
node "node_modules\tsx\dist\cli.mjs" "src\server.ts" --mock
pause
