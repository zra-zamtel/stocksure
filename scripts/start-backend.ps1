#requires -Version 5.1
[CmdletBinding()]
param(
    [int]$Port = 8000
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$BackendDir = Join-Path $RepoRoot 'backend'
$VenvDir = Join-Path $BackendDir '.venv'

if ($env:OS -eq 'Windows_NT') {
    $VenvPython = Join-Path $VenvDir 'Scripts\python.exe'
} else {
    $VenvPython = Join-Path $VenvDir 'bin/python'
}

if (-not (Test-Path $VenvPython) -or -not (Test-Path (Join-Path $BackendDir '.env'))) {
    Write-Host 'Backend is not set up yet; running setup first.' -ForegroundColor Yellow
    & (Join-Path $PSScriptRoot 'setup.ps1') -SkipMobile
}

Push-Location $BackendDir
try {
    Write-Host ''
    Write-Host "Starting Django on http://localhost:$Port" -ForegroundColor Green
    Write-Host 'Press Ctrl+C to stop.' -ForegroundColor DarkGray
    Write-Host 'A phone or emulator must reach this machine on the same network.' -ForegroundColor DarkGray
    Write-Host "If it cannot connect, allow port $Port through Windows Firewall." -ForegroundColor DarkGray
    Write-Host ''

    & $VenvPython manage.py check
    if ($LASTEXITCODE -ne 0) {
        throw 'backend/.env is not usable. Set DJANGO_SECRET_KEY and DJANGO_ALLOWED_HOSTS, or delete backend/.env and rerun .\scripts\setup.ps1 for local-demo values.'
    }

    & $VenvPython manage.py migrate --noinput
    if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }

    & $VenvPython manage.py runserver "0.0.0.0:$Port"
} finally {
    Pop-Location
}
