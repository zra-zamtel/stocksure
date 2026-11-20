#requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$BackendOnly,
    [switch]$NoTunnel
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$backendScript = Join-Path $PSScriptRoot 'start-backend.ps1'
$mobileScript = Join-Path $PSScriptRoot 'start-mobile.ps1'
$tunnelScript = Join-Path $PSScriptRoot 'start-tunnel.ps1'
$mobileEnvFile = Join-Path $RepoRoot 'mobile\.env.local'

$shell = (Get-Process -Id $PID).Path
if (-not $shell) {
    $shell = (Get-Command powershell.exe -ErrorAction Stop).Source
}

Write-Host 'Opening the backend in a new window...' -ForegroundColor Cyan
Start-Process -FilePath $shell -ArgumentList "-NoExit -ExecutionPolicy Bypass -File `"$backendScript`""

if (-not $BackendOnly) {
    if (-not $NoTunnel) {
        Start-Sleep -Seconds 2
        Write-Host 'Opening the Cloudflare tunnel in a new window...' -ForegroundColor Cyan
        Start-Process -FilePath $shell -ArgumentList "-NoExit -ExecutionPolicy Bypass -File `"$tunnelScript`""

        # Expo reads EXPO_PUBLIC_API_URL at startup, so wait for the tunnel to write it.
        Write-Host 'Waiting for the public API URL...' -ForegroundColor DarkGray
        $deadline = (Get-Date).AddSeconds(45)
        $url = $null
        while (-not $url -and (Get-Date) -lt $deadline) {
            if (Test-Path $mobileEnvFile) {
                $match = Select-String -Path $mobileEnvFile -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue |
                    Select-Object -First 1
                if ($match) { $url = $match.Matches[0].Value }
            }
            if (-not $url) { Start-Sleep -Milliseconds 500 }
        }
        if ($url) {
            Write-Host "  $url" -ForegroundColor Yellow
        } else {
            Write-Host 'No tunnel URL yet. Expo will use whatever is already in mobile\.env.local.' -ForegroundColor Yellow
        }
        Start-Sleep -Seconds 1
    }

    Write-Host 'Opening Expo in a new window...' -ForegroundColor Cyan
    Start-Process -FilePath $shell -ArgumentList "-NoExit -ExecutionPolicy Bypass -File `"$mobileScript`""
}

Write-Host ''
if ($BackendOnly) {
    Write-Host 'Backend window is starting.' -ForegroundColor Green
} else {
    Write-Host 'Backend, tunnel and Expo windows are starting.' -ForegroundColor Green
}
Write-Host 'Close a window or press Ctrl+C inside it to stop that service.' -ForegroundColor DarkGray
