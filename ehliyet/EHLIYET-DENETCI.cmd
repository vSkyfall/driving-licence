@echo off
setlocal
cd /d "%~dp0"
title EHLIYET Denetci
echo.
echo  EHLIYET Denetci - yapay zeka ajanlari icin ehliyet sinavi
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kurun.
  pause
  exit /b 1
)
if not exist "node_modules\tsx\dist\cli.mjs" (
  echo  Ilk kurulum: bagimliliklar indiriliyor, 1-2 dakika surebilir...
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo  npm install basarisiz oldu.
    pause
    exit /b 1
  )
  echo.
  echo  Kurulum testi:
  node "node_modules\tsx\dist\cli.mjs" "test\selftest.ts"
  echo.
)
if not exist ".env" copy ".env.example" ".env" >nul
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 4; Start-Process 'http://localhost:4747'"
node "node_modules\tsx\dist\cli.mjs" "src\server.ts"
pause
