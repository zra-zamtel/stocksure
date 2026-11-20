#requires -Version 5.1
[CmdletBinding()]
param(
    [int]$Port = 8000,
    [string]$Cloudflared
)

# Puts a public Cloudflare quick tunnel in front of the local Django server and
# writes the URL to mobile/.env.local as EXPO_PUBLIC_API_URL, so `npx expo start`
# reaches this backend with no copy-paste.
#
# The URL is random and changes on every run, and quick tunnels carry no uptime
# guarantee. Start this before Expo and leave the window open for the demo.

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$MobileDir = Join-Path $RepoRoot 'mobile'
$EnvFile = Join-Path $MobileDir '.env.local'

if (-not $Cloudflared) {
    $onPath = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($onPath) {
        $Cloudflared = $onPath.Source
    } else {
        $local = Join-Path $env:USERPROFILE '.local\bin\cloudflared.exe'
        if (Test-Path $local) { $Cloudflared = $local }
    }
}
if (-not $Cloudflared -or -not (Test-Path $Cloudflared)) {
    throw 'cloudflared not found. Install it (winget install Cloudflare.cloudflared) or drop cloudflared.exe in %USERPROFILE%\.local\bin.'
}

# Drop the URL from a previous run so Expo cannot be pointed at a dead tunnel.
if (Test-Path $EnvFile) {
    $kept = @(Get-Content $EnvFile | Where-Object { $_ -notmatch '^\s*EXPO_PUBLIC_API_URL\s*=' })
    Set-Content -Path $EnvFile -Value $kept -Encoding UTF8
}

$log = Join-Path ([System.IO.Path]::GetTempPath()) "stocksure-cloudflared-$PID.log"
Remove-Item $log, "$log.out" -ErrorAction SilentlyContinue

Write-Host ''
Write-Host "Opening a Cloudflare quick tunnel to http://127.0.0.1:$Port" -ForegroundColor Green
Write-Host 'The public URL changes every run. Keep this window open during the demo.' -ForegroundColor DarkGray
Write-Host ''

# http2 rather than the default quic: quic kept timing out on this network.
$proc = Start-Process -FilePath $Cloudflared `
    -ArgumentList @('tunnel', '--url', "http://127.0.0.1:$Port", '--protocol', 'http2', '--no-autoupdate') `
    -NoNewWindow -PassThru `
    -RedirectStandardOutput "$log.out" -RedirectStandardError $log

try {
    $url = $null
    $deadline = (Get-Date).AddSeconds(45)
    while (-not $url -and (Get-Date) -lt $deadline) {
        if ($proc.HasExited) { break }
        if (Test-Path $log) {
            $match = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue |
                Select-Object -First 1
            if ($match) { $url = $match.Matches[0].Value }
        }
        if (-not $url) { Start-Sleep -Milliseconds 500 }
    }

    if (-not $url) {
        throw 'The tunnel did not report a URL within 45 seconds. Check the connection and try again.'
    }

    Add-Content -Path $EnvFile -Value "EXPO_PUBLIC_API_URL=$url" -Encoding UTF8

    Write-Host 'Public API URL:' -ForegroundColor Cyan
    Write-Host "  $url" -ForegroundColor Yellow
    Write-Host ''
    Write-Host 'Saved to mobile\.env.local as EXPO_PUBLIC_API_URL.' -ForegroundColor DarkGray
    Write-Host 'Start Expo after this appears: Expo reads the value at startup.' -ForegroundColor DarkGray
    Write-Host 'Press Ctrl+C to close the tunnel.' -ForegroundColor DarkGray
    Write-Host ''

    Wait-Process -Id $proc.Id
} finally {
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item $log, "$log.out" -ErrorAction SilentlyContinue
}
