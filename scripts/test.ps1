#requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$BackendOnly,
    [switch]$MobileOnly
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$BackendDir = Join-Path $RepoRoot 'backend'
$MobileDir = Join-Path $RepoRoot 'mobile'
$VenvDir = Join-Path $BackendDir '.venv'

if ($env:OS -eq 'Windows_NT') {
    $VenvPython = Join-Path $VenvDir 'Scripts\python.exe'
} else {
    $VenvPython = Join-Path $VenvDir 'bin/python'
}

if (-not $MobileOnly) {
    if (-not (Test-Path $VenvPython)) {
        Write-Host 'Backend is not set up yet; running setup first.' -ForegroundColor Yellow
        & (Join-Path $PSScriptRoot 'setup.ps1') -SkipMobile
    }

    Write-Host ''
    Write-Host '==> Backend tests' -ForegroundColor Cyan
    Push-Location $BackendDir
    try {
        & $VenvPython manage.py test
        if ($LASTEXITCODE -ne 0) { throw "Backend tests failed with exit code $LASTEXITCODE." }
    } finally {
        Pop-Location
    }
}

if (-not $BackendOnly) {
    if (-not (Test-Path (Join-Path $MobileDir 'node_modules'))) {
        Write-Host 'Mobile dependencies are not installed yet; running setup first.' -ForegroundColor Yellow
        & (Join-Path $PSScriptRoot 'setup.ps1') -SkipBackend
    }

    Push-Location $MobileDir
    try {
        Write-Host ''
        Write-Host '==> Mobile unit and integration tests' -ForegroundColor Cyan
        & npm test
        if ($LASTEXITCODE -ne 0) { throw "Mobile tests failed with exit code $LASTEXITCODE." }

        Write-Host ''
        Write-Host '==> TypeScript' -ForegroundColor Cyan
        & npm run typecheck
        if ($LASTEXITCODE -ne 0) { throw "TypeScript failed with exit code $LASTEXITCODE." }

        Write-Host ''
        Write-Host '==> Lint' -ForegroundColor Cyan
        & npm run lint
        if ($LASTEXITCODE -ne 0) { throw "Lint failed with exit code $LASTEXITCODE." }
    } finally {
        Pop-Location
    }
}

Write-Host ''
Write-Host 'All checks passed.' -ForegroundColor Green
