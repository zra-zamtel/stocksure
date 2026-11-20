#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$StackName = 'stocksure-api',
    [string]$Region = 'eu-north-1',
    [string]$ArtifactBucket = 'stocksure-lambda-artifacts-866874944490',
    [string]$SmtpCheckTo = '',
    [switch]$Migrate,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$BackendDir = Join-Path $RepoRoot 'backend'
$LambdaZip = Join-Path $BackendDir 'build\lambda.zip'

$invokeOnly = $SkipBuild -and ($Migrate -or $SmtpCheckTo)

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw "aws is not installed or not on PATH. See backend/README.md for prerequisites."
}

$samCommand = Get-Command sam -ErrorAction SilentlyContinue
if (-not $samCommand) {
    $samCmd = 'C:\Program Files\Amazon\AWSSAMCLI\bin\sam.cmd'
    if (Test-Path $samCmd) { $samCommand = $samCmd }
}
if (-not $invokeOnly -and -not $samCommand) {
    throw "SAM CLI is not installed. Run: winget install --id Amazon.SAM-CLI -e"
}

Push-Location $BackendDir
try {
    if (-not $invokeOnly) {
        if (-not $SkipBuild) {
            & (Join-Path $PSScriptRoot 'build-lambda.ps1')
            if ($LASTEXITCODE -ne 0) { throw 'Lambda package build failed.' }
        }

        if (-not (Test-Path $LambdaZip)) {
            throw "Missing $LambdaZip. Run without -SkipBuild first."
        }

        Write-Host ''
        Write-Host '==> sam deploy' -ForegroundColor Cyan
        $deployArgs = @('deploy', '--stack-name', $StackName, '--region', $Region)
        if ($ArtifactBucket) {
            # This account's SCP blocks SAM's managed artifact stack, so use a
            # bucket that already exists in the target region.
            $deployArgs += @('--s3-bucket', $ArtifactBucket, '--s3-prefix', 'stocksure')
        } else {
            $deployArgs += '--resolve-s3'
        }
        if (Test-Path (Join-Path $BackendDir 'samconfig.toml')) {
            $deployArgs += @('--capabilities', 'CAPABILITY_IAM', '--no-confirm-changeset', '--no-fail-on-empty-changeset')
        } else {
            $deployArgs += '--guided'
        }
        & $samCommand @deployArgs
        if ($LASTEXITCODE -ne 0) { throw 'sam deploy failed.' }
    }

    $outputsJson = & aws cloudformation describe-stacks `
        --stack-name $StackName `
        --region $Region `
        --query 'Stacks[0].Outputs' `
        --output json
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the stack outputs.' }

    $outputByName = @{}
    foreach ($output in ($outputsJson | ConvertFrom-Json)) {
        $outputByName[$output.OutputKey] = $output.OutputValue
    }

    Write-Host ''
    Write-Host "API URL:  $($outputByName['ApiUrl'])" -ForegroundColor Green
    Write-Host "Health:   $($outputByName['HealthUrl'])" -ForegroundColor Green
    Write-Host "Docs:     $($outputByName['DocsUrl'])" -ForegroundColor Green
    Write-Host "Set EXPO_PUBLIC_API_URL=$($outputByName['ApiUrl']) for the mobile app." -ForegroundColor Yellow

    $jobFunction = $outputByName['JobFunctionName']
    if (($Migrate -or $SmtpCheckTo) -and -not $jobFunction) {
        throw 'JobFunctionName is missing from the stack outputs.'
    }

    function Invoke-Job {
        param([hashtable]$Payload)

        $json = $Payload | ConvertTo-Json -Compress
        $payloadBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
        $responseFile = Join-Path $env:TEMP 'stocksure-lambda-response.json'

        Write-Host ''
        Write-Host "==> Invoking $jobFunction with $json" -ForegroundColor Cyan
        & aws lambda invoke `
            --function-name $jobFunction `
            --region $Region `
            --payload $payloadBase64 `
            $responseFile | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'aws lambda invoke failed.' }

        Get-Content $responseFile
        Remove-Item $responseFile -ErrorAction SilentlyContinue
    }

    if ($Migrate) {
        Invoke-Job @{ job = 'migrate' }
    }

    if ($SmtpCheckTo) {
        Invoke-Job @{ job = 'smtp-check'; to = $SmtpCheckTo }
    }
} finally {
    Pop-Location
}
