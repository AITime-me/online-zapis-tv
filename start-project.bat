@echo off
setlocal
cd /d %~dp0

echo ========================================
echo   Online-zapis-tv — start project
echo ========================================
echo.

echo [1/3] PostgreSQL (Docker)...
docker info >nul 2>&1
if errorlevel 1 (
  echo WARNING: Docker Desktop is not running.
  echo Start Docker Desktop, then run this script again.
  echo Without Postgres the app will not work on /schedule.
  echo.
) else (
  docker compose up -d
  if errorlevel 1 (
    echo ERROR: docker compose up failed.
    pause
    exit /b 1
  )
  echo Postgres container started (restart: unless-stopped).
  echo.
)

echo [2/3] npm install...
call npm install
if errorlevel 1 (
  echo ERROR: npm install failed.
  pause
  exit /b 1
)
echo.

echo [3/3] npm run dev...
echo App: http://localhost:3000
echo Press Ctrl+C to stop the dev server.
echo.
call npm run dev

pause
