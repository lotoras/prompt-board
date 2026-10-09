@echo off
title Prompt Board - Building...
cd /d "%~dp0.."
echo Building Prompt Board...
echo.
call "%CD%\node_modules\.bin\electron-vite.cmd" build
if errorlevel 1 goto :failed
echo.
echo Build OK - starting Prompt Board...
start "" "%CD%\node_modules\electron\dist\electron.exe" "%CD%"
exit /b 0
:failed
echo.
echo ============================================
echo  BUILD FAILED - app NOT started.
echo  Fix the error above, then relaunch.
echo ============================================
echo.
pause
exit /b 1
