@echo off
setlocal

set "NODE_EXE=node"
where node >nul 2>nul
if errorlevel 1 (
    if exist "%ProgramFiles%\nodejs\node.exe" (
        set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
    ) else (
        echo ERROR: node.exe was not found on PATH or in %%ProgramFiles%%\nodejs.
        exit /b 1
    )
)

set "TWEEGO_EXE=tweego"
where tweego >nul 2>nul
if errorlevel 1 (
    if exist "%USERPROFILE%\.local\bin\tweego.exe" (
        set "TWEEGO_EXE=%USERPROFILE%\.local\bin\tweego.exe"
    ) else if exist "%LOCALAPPDATA%\Tweego\tweego.exe" (
        set "TWEEGO_EXE=%LOCALAPPDATA%\Tweego\tweego.exe"
    ) else (
        echo ERROR: tweego.exe was not found on PATH or in a standard local install directory.
        exit /b 1
    )
)

if not defined TWEEGO_PATH if exist "%LOCALAPPDATA%\Tweego\storyformats" (
    set "TWEEGO_PATH=%LOCALAPPDATA%\Tweego\storyformats"
)

if not exist dist mkdir dist

echo Running JavaScript tests...
"%NODE_EXE%" tests\run-tests.js
if errorlevel 1 exit /b 1

echo Building dist\game.html...
"%TWEEGO_EXE%" -o dist\game.html src
if errorlevel 1 exit /b 1

echo Build complete: dist\game.html
endlocal
