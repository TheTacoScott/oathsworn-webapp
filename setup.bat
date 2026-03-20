@echo off
:: Does this bat file work? I have no idea I used gemini to generate it using the setup.sh and Dockerfile as context.
setlocal enabledelayedexpansion

:: Get the directory where the script is located
set "SCRIPT_DIR=%~dp0"

:: Set Output Directory (Default to ./web)
if "%~1"=="" (
    set "OUTPUT_DIR=%SCRIPT_DIR%web"
) else (
    set "OUTPUT_DIR=%~1"
)

:: Set Cache Directory (Check environment variable first)
if "%APK_CACHE%"=="" (
    set "CACHE_DIR=%SCRIPT_DIR%cache"
) else (
    set "CACHE_DIR=%APK_CACHE%"
)

:: Resolve absolute paths for Docker volumes
for %%i in ("%OUTPUT_DIR%") do set "FULL_OUTPUT_DIR=%%~fi"
for %%i in ("%CACHE_DIR%") do set "FULL_CACHE_DIR=%%~fi"

echo Output:    %FULL_OUTPUT_DIR%
echo APK cache: %FULL_CACHE_DIR%
echo.

:: Ensure directories exist
if not exist "%FULL_OUTPUT_DIR%\data" mkdir "%FULL_OUTPUT_DIR%\data"
if not exist "%FULL_CACHE_DIR%" mkdir "%FULL_CACHE_DIR%"

echo Building setup image...
docker build -t oathsworn-setup -f "%SCRIPT_DIR%Dockerfile" "%SCRIPT_DIR%"

echo.
echo Running setup...
:: We pass 1000 for UID/GID as a safe default for Linux-based containers
docker run --rm ^
    -e HOST_UID=1000 ^
    -e HOST_GID=1000 ^
    -v "%FULL_OUTPUT_DIR%\data:/repo/web/data" ^
    -v "%FULL_CACHE_DIR%:/cache" ^
    oathsworn-setup

:: Copy static web assets if the output dir is not the internal web dir
set "WEB_SRC=%SCRIPT_DIR%web"
:: Resolve WEB_SRC to absolute for comparison
for %%i in ("%WEB_SRC%") do set "FULL_WEB_SRC=%%~fi"

if /I "%FULL_OUTPUT_DIR%" NEQ "%FULL_WEB_SRC%" (
    echo.
    echo Copying static files to %FULL_OUTPUT_DIR%...
    copy "%FULL_WEB_SRC%\index.html" "%FULL_OUTPUT_DIR%\" /Y >nul
    xcopy "%FULL_WEB_SRC%\css" "%FULL_OUTPUT_DIR%\css" /E /I /Y >nul
    xcopy "%FULL_WEB_SRC%\js" "%FULL_OUTPUT_DIR%\js" /E /I /Y >nul
)

echo.
echo Done.
echo Open: %FULL_OUTPUT_DIR%\index.html
pause
