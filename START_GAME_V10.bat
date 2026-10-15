@echo off
setlocal
cd /d "%~dp0"
echo ===============================================
echo   THREE WORLDS OF TIME - FUTURE V10
 echo  Test BIG JUMP with SHIFT + UP + SPACE
 echo  Safe falling-brick sprint and colour lock
 echo ===============================================
if not exist "index.html" (
  echo ERROR: index.html missing. Extract the FULL SOURCE ZIP completely.
  pause
  exit /b 1
)
if not exist "src\core\flashlightInk.js" (
  echo ERROR: src\core\flashlightInk.js missing. Extract all files from the ZIP.
  pause
  exit /b 1
)
if not exist "src\levels\neonFuture.js" (
  echo ERROR: Future level source missing.
  pause
  exit /b 1
)
echo Serving this folder on http://localhost:8018/?qa=1
echo Leave this window open while playing. Press Ctrl+C to stop.
start "" "http://localhost:8018/?qa=1"
py -m http.server 8018
if errorlevel 1 (
  echo Python launcher unavailable or port occupied.
  echo Try: python -m http.server 8019
  pause
)
