[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$outputDir = Join-Path $root '.agent-packages'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$baseName = "Mallowstead-agent-$timestamp"
$outputPath = Join-Path $outputDir "$baseName.zip"
$collision = 1
while (Test-Path -LiteralPath $outputPath) {
    $outputPath = Join-Path $outputDir ("{0}-{1}.zip" -f $baseName, $collision)
    $collision += 1
}

$sourceDirectories = @('data', 'docs', 'editor', 'src', 'tests', 'tools')
$rootFiles = @(
    'AGENTS.md',
    'README.md',
    'PLAYER-README.md',
    'LICENSE',
    'build.sh',
    'build.bat',
    'test.sh',
    'test.bat',
    '.gitignore'
)
$excludedExtensions = @('.zip', '.rar', '.7z', '.log', '.bak')
$excludedSegments = @('.git', '.build', 'dist', 'model-contract-bench', '.agent-packages', '.vscode')

function Get-RelativePath([string]$Path) {
    $rootUri = [System.Uri]::new(($root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar))
    $fileUri = [System.Uri]::new($Path)
    return [System.Uri]::UnescapeDataString($rootUri.MakeRelativeUri($fileUri).ToString()).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
}

function Test-IncludedFile([System.IO.FileInfo]$File) {
    if ($excludedExtensions -contains $File.Extension.ToLowerInvariant()) { return $false }
    $relative = Get-RelativePath $File.FullName
    $segments = $relative -split '[\\/]'
    foreach ($segment in $segments) {
        if ($excludedSegments -contains $segment) { return $false }
    }
    return $true
}

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$staging = Join-Path ([System.IO.Path]::GetTempPath()) ("mallowstead-agent-{0}" -f [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging -Force | Out-Null

try {
    $files = New-Object System.Collections.Generic.List[System.IO.FileInfo]
    foreach ($directoryName in $sourceDirectories) {
        $directoryPath = Join-Path $root $directoryName
        if (-not (Test-Path -LiteralPath $directoryPath -PathType Container)) { continue }
        Get-ChildItem -LiteralPath $directoryPath -Recurse -File | ForEach-Object {
            if (Test-IncludedFile $_) { $files.Add($_) }
        }
    }
    foreach ($fileName in $rootFiles) {
        $filePath = Join-Path $root $fileName
        if (Test-Path -LiteralPath $filePath -PathType Leaf) {
            $file = Get-Item -LiteralPath $filePath
            if (Test-IncludedFile $file) { $files.Add($file) }
        }
    }

    $unique = $files | Sort-Object FullName -Unique
    if (-not $unique -or $unique.Count -eq 0) { throw 'No development files matched the agent-package whitelist.' }

    foreach ($file in $unique) {
        $relative = Get-RelativePath $file.FullName
        $destination = Join-Path $staging $relative
        $destinationDir = Split-Path -Parent $destination
        if ($destinationDir) { New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null }
        Copy-Item -LiteralPath $file.FullName -Destination $destination
    }

    Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $outputPath -CompressionLevel Optimal
    if (-not (Test-Path -LiteralPath $outputPath -PathType Leaf)) { throw 'Compression completed without producing an archive.' }
    $archive = Get-Item -LiteralPath $outputPath
    Write-Host ("Agent package created: {0}" -f $archive.FullName)
    Write-Host ("Included files: {0}; archive size: {1} bytes" -f $unique.Count, $archive.Length)
}
catch {
    if (Test-Path -LiteralPath $outputPath) { Remove-Item -LiteralPath $outputPath -Force -ErrorAction SilentlyContinue }
    Write-Error ("Agent packaging failed: {0}" -f $_.Exception.Message)
    exit 1
}
finally {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue }
}
