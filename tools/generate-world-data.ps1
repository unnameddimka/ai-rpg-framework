param(
    [string]$InputPath = (Join-Path $PSScriptRoot "..\data\world.json"),
    [string]$OutputPath = (Join-Path $PSScriptRoot "..\src\generated\world-data.js"),
    [string]$PassagesPath = (Join-Path $PSScriptRoot "..\src\generated\world-passages.twee"),
    [string]$StoryDataPath = (Join-Path $PSScriptRoot "..\src\generated\world-storydata.twee")
)

$ErrorActionPreference = "Stop"
$node = Get-Command node -ErrorAction Stop
$script = Join-Path $PSScriptRoot "generate-world-data.js"

# Compatibility wrapper only. The JavaScript generator + shared authored validator
# are the single authoritative implementation; do not duplicate validation here.
& $node.Source $script `
    --input ([IO.Path]::GetFullPath($InputPath)) `
    --output ([IO.Path]::GetFullPath($OutputPath)) `
    --passages ([IO.Path]::GetFullPath($PassagesPath)) `
    --story-data ([IO.Path]::GetFullPath($StoryDataPath))
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
