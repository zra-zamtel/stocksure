#requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$MobileDir = Join-Path $RepoRoot 'mobile'

$packageLock = Join-Path $MobileDir 'package-lock.json'
$installMarker = Join-Path $MobileDir 'node_modules\.package-lock.json'
$needsInstall = -not (Test-Path $installMarker)
if (-not $needsInstall -and (Test-Path $packageLock)) {
    $needsInstall = (Get-Item $packageLock).LastWriteTimeUtc -gt (Get-Item $installMarker).LastWriteTimeUtc
}
if ($needsInstall) {
    Write-Host 'Mobile dependencies are not installed or are out of date; running setup first.' -ForegroundColor Yellow
    & (Join-Path $PSScriptRoot 'setup.ps1') -SkipBackend
}

Push-Location $MobileDir
try {
    Write-Host ''
    Write-Host 'Starting Expo...' -ForegroundColor Green
    Write-Host 'Scan the QR code with Expo Go, or press "a" for the Android emulator.' -ForegroundColor DarkGray
    Write-Host 'Press Ctrl+C to stop.' -ForegroundColor DarkGray
    Write-Host ''

    & npx expo start
} finally {
    Pop-Location
}
