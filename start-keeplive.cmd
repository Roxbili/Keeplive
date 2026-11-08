@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 24 或更高版本，再重新打开。
  pause
  exit /b 1
)
if not exist node_modules (
  echo 正在安装 Keeplive 所需组件...
  call npm.cmd ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo 正在准备相册界面...
call npm.cmd run build
if errorlevel 1 (
  pause
  exit /b 1
)
echo 请保持本窗口运行。按 Ctrl+C 停止相册。
call npm.cmd start
pause
