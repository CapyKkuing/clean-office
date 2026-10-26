@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 가 필요합니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)
if not exist node_modules (
  echo 처음 실행 준비 중... 필요한 부품을 내려받습니다. 몇 분 걸릴 수 있습니다.
  call npm install
)
if not exist dist\index.html (
  call npm run build
)
echo 클린오피스를 켭니다. 이 창을 닫으면 클린오피스와 폰 연결이 꺼집니다.
node server\server.mjs
pause
