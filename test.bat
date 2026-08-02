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

"%NODE_EXE%" tests\run-tests.js
endlocal
