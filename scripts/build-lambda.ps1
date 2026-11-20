#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Runtime = 'python3.12',
    [string]$Python = ''
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$BackendDir = Join-Path $RepoRoot 'backend'
$BuildDir = Join-Path $BackendDir 'build\lambda'
$ZipPath = Join-Path $BackendDir 'build\lambda.zip'
$Requirements = Join-Path $BackendDir 'requirements-lambda.txt'

if (-not $Python) {
    $venvPython = Join-Path $BackendDir '.venv\Scripts\python.exe'
    $Python = if (Test-Path $venvPython) { $venvPython } else { 'python' }
}

switch ($Runtime) {
    'python3.12' { $pyVersion = '3.12'; $abi = 'cp312' }
    'python3.13' { $pyVersion = '3.13'; $abi = 'cp313' }
    default { throw "Unsupported runtime '$Runtime'. Use python3.12 or python3.13." }
}

Write-Host "==> Cleaning $BuildDir" -ForegroundColor Cyan
if (Test-Path $BuildDir) { Remove-Item -Recurse -Force $BuildDir }
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null

Write-Host "==> Installing Linux wheels for $Runtime (no Docker)" -ForegroundColor Cyan
& $Python -m pip install `
    --quiet `
    --no-compile `
    --disable-pip-version-check `
    --platform manylinux2014_x86_64 `
    --platform manylinux_2_28_x86_64 `
    --platform manylinux_2_17_x86_64 `
    --python-version $pyVersion `
    --implementation cp `
    --abi $abi `
    --only-binary=:all: `
    --target $BuildDir `
    -r $Requirements
if ($LASTEXITCODE -ne 0) { throw 'pip could not install Linux wheels for the Lambda bundle.' }

Write-Host '==> Copying application code' -ForegroundColor Cyan
Copy-Item -Recurse -Force (Join-Path $BackendDir 'apps') $BuildDir
Copy-Item -Recurse -Force (Join-Path $BackendDir 'config') $BuildDir
Copy-Item -Force (Join-Path $BackendDir 'manage.py') $BuildDir

Get-ChildItem -Path $BuildDir -Recurse -Directory -Filter '__pycache__' |
    Remove-Item -Recurse -Force
Get-ChildItem -Path $BuildDir -Recurse -File -Filter '*.pyc' |
    Remove-Item -Force

Write-Host '==> Collecting static files' -ForegroundColor Cyan
$staticSource = Join-Path $BackendDir 'staticfiles'
if (Test-Path $staticSource) { Remove-Item -Recurse -Force $staticSource }

$envNames = @(
    'DJANGO_DEBUG',
    'DJANGO_SECRET_KEY',
    'DJANGO_ALLOWED_HOSTS',
    'AWS_LAMBDA_FUNCTION_NAME',
    'DATABASE_URL',
    'MEDIA_BUCKET'
)
$previousEnv = @{}
foreach ($name in $envNames) { $previousEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

try {
    $env:DJANGO_DEBUG = '1'
    $env:DJANGO_SECRET_KEY = 'build-only-not-a-secret'
    $env:DJANGO_ALLOWED_HOSTS = '*'
    $env:AWS_LAMBDA_FUNCTION_NAME = ''
    $env:DATABASE_URL = ''
    $env:MEDIA_BUCKET = ''

    & $Python (Join-Path $BackendDir 'manage.py') collectstatic --noinput
    if ($LASTEXITCODE -ne 0) { throw 'collectstatic failed.' }
} finally {
    foreach ($name in $envNames) {
        if ($null -eq $previousEnv[$name]) {
            Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
        } else {
            Set-Item -Path "Env:$name" -Value $previousEnv[$name]
        }
    }
}

$staticSource = Join-Path $BackendDir 'staticfiles'
if (-not (Test-Path $staticSource)) { throw 'collectstatic did not produce backend/staticfiles.' }
Copy-Item -Recurse -Force $staticSource (Join-Path $BuildDir 'staticfiles')

$unzippedMB = [math]::Round(((Get-ChildItem $BuildDir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host "Unzipped size: $unzippedMB MB" -ForegroundColor Cyan
if ($unzippedMB -gt 250) {
    throw "The bundle is $unzippedMB MB, over Lambda's 250 MB unzipped limit."
}

Write-Host '==> Creating zip' -ForegroundColor Cyan
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    Get-ChildItem -Path $BuildDir -Recurse -File | ForEach-Object {
        # The zip spec requires forward slashes; CreateFromDirectory on Windows
        # writes backslashes, which the Lambda file loader cannot resolve.
        $relative = $_.FullName.Substring($BuildDir.Length + 1).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive,
            $_.FullName,
            $relative,
            [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    }
} finally {
    $archive.Dispose()
}

$zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
    $names = $zip.Entries | ForEach-Object { $_.FullName }
    if ($names -notcontains 'config/lambda_handler.py') { throw 'The zip is missing config/lambda_handler.py.' }
    if ($names -notcontains 'config/lambda_jobs.py') { throw 'The zip is missing config/lambda_jobs.py.' }
    if ($names -notcontains 'config/lambda_warm.py') { throw 'The zip is missing config/lambda_warm.py.' }
    if (-not ($names | Where-Object { $_ -like 'staticfiles/*' })) { throw 'The zip is missing collected static files.' }
} finally {
    $zip.Dispose()
}

$zipMB = [math]::Round(((Get-Item $ZipPath).Length / 1MB), 1)
Write-Host "Lambda package: $ZipPath ($zipMB MB)" -ForegroundColor Green
