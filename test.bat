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

"%NODE_EXE%" tools\generate-model-list.js
if errorlevel 1 exit /b 1

"%NODE_EXE%" tools\generate-world-data.js
if errorlevel 1 exit /b 1

"%NODE_EXE%" tests\run-tests.js
if errorlevel 1 exit /b 1
"%NODE_EXE%" tests\run-migration-tests.js
if errorlevel 1 exit /b 1
"%NODE_EXE%" tests\run-persistence-tests.js
if errorlevel 1 exit /b 1
"%NODE_EXE%" tests\run-editor-tests.js
if errorlevel 1 exit /b 1
"%NODE_EXE%" tests\run-ui-tests.js
if errorlevel 1 exit /b 1
"%NODE_EXE%" tests\run-ai-tests.js
if errorlevel 1 exit /b 1
"%NODE_EXE%" tests\run-quality-pass-tests.js
if errorlevel 1 exit /b 1
"%NODE_EXE%" tests\run-ai-liveness-tests.js
if errorlevel 1 exit /b 1
"%NODE_EXE%" tests\run-generator-tests.js
if errorlevel 1 exit /b 1
"%NODE_EXE%" tests\run-narrator-tests.js
if errorlevel 1 exit /b 1
"%NODE_EXE%" tests\run-memory-consolidation-tests.js
if errorlevel 1 exit /b 1
"%NODE_EXE%" tests\run-night-timelapse-tests.js
if errorlevel 1 exit /b 1
"%NODE_EXE%" tests\run-daytime-tests.js
if errorlevel 1 exit /b 1
endlocal
