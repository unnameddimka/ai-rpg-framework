@echo off
setlocal
set "PROFILE=%~1"
if "%PROFILE%"=="" set "PROFILE=public"
if not "%~2"=="" (
    echo ERROR: usage: build.bat [public^|private]
    exit /b 1
)

set "NODE_EXE=node"
where node >nul 2>nul
if errorlevel 1 (
    if exist "%ProgramFiles%\nodejs\node.exe" (set "NODE_EXE=%ProgramFiles%\nodejs\node.exe") else (
        echo ERROR: node.exe was not found on PATH or in %%ProgramFiles%%\nodejs.
        exit /b 1
    )
)
"%NODE_EXE%" tools\build-profile.js "%PROFILE%" >nul
if errorlevel 1 exit /b 1

set "TWEEGO_EXE=tweego"
where tweego >nul 2>nul
if errorlevel 1 (
    if exist "%USERPROFILE%\.local\bin\tweego.exe" (set "TWEEGO_EXE=%USERPROFILE%\.local\bin\tweego.exe") else if exist "%LOCALAPPDATA%\Tweego\tweego.exe" (set "TWEEGO_EXE=%LOCALAPPDATA%\Tweego\tweego.exe") else set "TWEEGO_EXE="
)
if not defined TWEEGO_PATH if exist "%LOCALAPPDATA%\Tweego\storyformats" set "TWEEGO_PATH=%LOCALAPPDATA%\Tweego\storyformats"
if not exist dist mkdir dist

echo Running JavaScript tests against the public canonical world...
call test.bat
if errorlevel 1 exit /b 1

echo Preparing %PROFILE% build source...
"%NODE_EXE%" tools\prepare-build.js "%PROFILE%"
if errorlevel 1 exit /b 1
set "SOURCE_DIR=%CD%\.build\%PROFILE%\src"
if /I "%PROFILE%"=="private" (set "OUTPUT=%CD%\dist\mallowstead-private.html") else set "OUTPUT=%CD%\dist\mallowstead.html"

echo Building %OUTPUT%...
if defined TWEEGO_EXE (
    "%TWEEGO_EXE%" -o "%OUTPUT%" "%SOURCE_DIR%"
    if errorlevel 1 exit /b 1
) else (
    echo Tweego not found; reusing an embedded SugarCube runtime template.
    set "TEMPLATE=%CD%\dist\mallowstead.html"
    if not exist "%CD%\dist\mallowstead.html" set "TEMPLATE=%CD%\dist\game.html"
    "%NODE_EXE%" tools\build-from-existing-runtime.js --source "%SOURCE_DIR%" --output "%OUTPUT%" --template "%TEMPLATE%"
    if errorlevel 1 exit /b 1
)
"%NODE_EXE%" tools\postprocess-product-title.js --input "%OUTPUT%"
if errorlevel 1 exit /b 1
if /I "%PROFILE%"=="public" (
    "%NODE_EXE%" tools\package-public-release.js
    if errorlevel 1 exit /b 1
)
"%NODE_EXE%" tools\cleanup-build.js "%PROFILE%" >nul

echo Build complete: %OUTPUT%
endlocal
