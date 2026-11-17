#requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$BackendOnly
)

$ErrorActionPreference = 'Stop'
$backendScript = Join-Path $PSScriptRoot 'start-backend.ps1'
$mobileScript = Join-Path $PSScriptRoot 'start-mobile.ps1'

$shell = (Get-Process -Id $PID).Path
if (-not $shell) {
    $shell = (Get-Command powershell.exe -ErrorAction Stop).Source
}

Write-Host 'Opening the backend in a new window...' -ForegroundColor Cyan
Start-Process -FilePath $shell -ArgumentList "-NoExit -ExecutionPolicy Bypass -File `"$backendScript`""

if (-not $BackendOnly) {
    Start-Sleep -Seconds 2
    Write-Host 'Opening Expo in a new window...' -ForegroundColor Cyan
    Start-Process -FilePath $shell -ArgumentList "-NoExit -ExecutionPolicy Bypass -File `"$mobileScript`""
}

Write-Host ''
if ($BackendOnly) {
    Write-Host 'Backend window is starting.' -ForegroundColor Green
} else {
    Write-Host 'Both windows are starting.' -ForegroundColor Green
}
Write-Host 'Close a window or press Ctrl+C inside it to stop that service.' -ForegroundColor DarkGray
