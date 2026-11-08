@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0deploy\windows\install-autostart.ps1"
if errorlevel 1 (
  echo Keeplive autostart setup failed. See the error above.
  pause
  exit /b 1
)
echo Keeplive will start in the background after Windows sign-in.
pause
