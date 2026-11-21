#requires -Version 5.1
<#
.SYNOPSIS
    Creates the GitHub Actions OIDC provider and deploy role for the Lambda stack.

.DESCRIPTION
    GitHub Actions assumes this role through OIDC, so the pipeline needs no
    long-lived access keys. The trust policy only allows the configured repo on
    the configured branch, or jobs running in the configured GitHub environment.
    Safe to re-run: existing resources are updated in place instead of
    duplicated.

.EXAMPLE
    .\scripts\setup-github-oidc.ps1 -ConfigureRepo

    Creates the role and stores its ARN as the AWS_DEPLOY_ROLE_ARN repository
    variable through the GitHub CLI.
#>
[CmdletBinding()]
param(
    [string]$GitHubRepo = 'zra-zamtel/stocksure',
    # GitHub's OIDC subject embeds immutable owner and repository IDs, e.g.
    # repo:zra-zamtel@357624666/stocksure@1460763018:environment:production.
    # Keep them in sync with the token if the repo is ever recreated.
    [string]$OwnerId = '357624666',
    [string]$RepoId = '1460763018',
    [string]$RoleName = 'GitHubActionsStockSureDeploy',
    [string]$Branch = 'main',
    [string]$Environment = 'production',
    [string]$Region = 'eu-north-1',
    [string]$ArtifactBucket = 'stocksure-lambda-artifacts-866874944490',
    [string]$StackName = 'stocksure-api',
    [switch]$ConfigureRepo
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw 'aws is not installed or not on PATH.'
}

$AccountId = (& aws sts get-caller-identity --query Account --output text).Trim()
if ($LASTEXITCODE -ne 0 -or -not $AccountId) {
    throw 'Could not resolve the AWS account. Run aws login first.'
}
Write-Host "Account: $AccountId  Repo: $GitHubRepo  Branch: $Branch" -ForegroundColor Cyan

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "stocksure-oidc-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

try {
    # ---------------------------------------------------------------- provider
    $ProviderArn = "arn:aws:iam::$AccountId`:oidc-provider/token.actions.githubusercontent.com"
    $Providers = & aws iam list-open-id-connect-providers --query 'OpenIDConnectProviderList[].Arn' --output text
    if ($Providers -and ($Providers -split "\s+") -contains $ProviderArn) {
        Write-Host '==> GitHub OIDC provider already exists' -ForegroundColor Yellow
    } else {
        Write-Host '==> Creating GitHub OIDC provider' -ForegroundColor Cyan
        # AWS no longer validates the thumbprint for GitHub, but the parameter
        # is still required by older CLI versions.
        & aws iam create-open-id-connect-provider `
            --url 'https://token.actions.githubusercontent.com' `
            --client-id-list 'sts.amazonaws.com' `
            --thumbprint-list '6938fd4d98bab03faadb97b34396831e3780aea1' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the GitHub OIDC provider.' }
    }

    # ------------------------------------------------------------------- trust
    $Owner, $Repo = $GitHubRepo -split '/', 2
    $RepoSubject = "repo:$Owner/$Repo"
    $RepoIdSubject = "repo:$Owner@$OwnerId/$Repo@$RepoId"
    $TrustPolicy = @"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "$ProviderArn" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": [
            "$RepoIdSubject`:ref:refs/heads/$Branch",
            "$RepoIdSubject`:environment:$Environment",
            "$RepoSubject`:ref:refs/heads/$Branch",
            "$RepoSubject`:environment:$Environment"
          ]
        }
      }
    }
  ]
}
"@
    $TrustFile = Join-Path $TempDir 'trust.json'
    Set-Content -Path $TrustFile -Value $TrustPolicy -Encoding ascii

    $RoleArn = "arn:aws:iam::$AccountId`:role/$RoleName"
    # aws writes "NoSuchEntity" to stderr when the role is absent; keep that
    # probe from tripping $ErrorActionPreference = 'Stop'.
    $ErrorActionPreference = 'Continue'
    & aws iam get-role --role-name $RoleName --output json > $null 2>&1
    $RoleExists = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = 'Stop'
    if ($RoleExists) {
        Write-Host '==> Updating trust policy on the existing deploy role' -ForegroundColor Cyan
        & aws iam update-assume-role-policy --role-name $RoleName --policy-document "file://$TrustFile" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not update the deploy role trust policy.' }
    } else {
        Write-Host '==> Creating the deploy role' -ForegroundColor Cyan
        & aws iam create-role `
            --role-name $RoleName `
            --description 'GitHub Actions deploy role for the StockSure Lambda stack' `
            --assume-role-policy-document "file://$TrustFile" `
            --tags Key=Application,Value=StockSure | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the deploy role.' }
    }

    # --------------------------------------------------------------- permissions
    $Policy = @"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ArtifactBucket",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:GetObjectVersion",
        "s3:AbortMultipartUpload",
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": [
        "arn:aws:s3:::$ArtifactBucket",
        "arn:aws:s3:::$ArtifactBucket/*"
      ]
    },
    {
      "Sid": "MediaBucket",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:DeleteBucket",
        "s3:GetBucketLocation",
        "s3:ListBucket",
        "s3:GetBucketPolicy",
        "s3:PutBucketPolicy",
        "s3:DeleteBucketPolicy",
        "s3:GetBucketPublicAccessBlock",
        "s3:PutBucketPublicAccessBlock",
        "s3:GetBucketOwnershipControls",
        "s3:PutBucketOwnershipControls",
        "s3:GetEncryptionConfiguration",
        "s3:PutEncryptionConfiguration",
        "s3:GetBucketTagging",
        "s3:PutBucketTagging"
      ],
      "Resource": [ "arn:aws:s3:::$StackName-*" ]
    },
    {
      "Sid": "StackChangesets",
      "Effect": "Allow",
      "Action": [
        "cloudformation:CreateStack",
        "cloudformation:UpdateStack",
        "cloudformation:DeleteStack",
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackEvents",
        "cloudformation:DescribeStackResources",
        "cloudformation:ListStackResources",
        "cloudformation:GetTemplate",
        "cloudformation:CreateChangeSet",
        "cloudformation:DescribeChangeSet",
        "cloudformation:ExecuteChangeSet",
        "cloudformation:DeleteChangeSet",
        "cloudformation:ListChangeSets",
        "cloudformation:TagResource",
        "cloudformation:UntagResource"
      ],
      "Resource": [
        "arn:aws:cloudformation:$Region`:$AccountId`:stack/$StackName/*",
        "arn:aws:cloudformation:$Region`:$AccountId`:stack/$StackName/*/*"
      ]
    },
    {
      "Sid": "TemplateInspection",
      "Effect": "Allow",
      "Action": [
        "cloudformation:GetTemplateSummary",
        "cloudformation:ValidateTemplate",
        "cloudformation:ListStacks"
      ],
      "Resource": "*"
    },
    {
      "Sid": "LambdaFunctions",
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:DeleteFunction",
        "lambda:GetFunction",
        "lambda:GetFunctionConfiguration",
        "lambda:GetFunctionCodeSigningConfig",
        "lambda:GetPolicy",
        "lambda:AddPermission",
        "lambda:RemovePermission",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:ListVersionsByFunction",
        "lambda:PublishVersion",
        "lambda:PutFunctionConcurrency",
        "lambda:DeleteFunctionConcurrency",
        "lambda:GetFunctionConcurrency",
        "lambda:PutFunctionEventInvokeConfig",
        "lambda:UpdateFunctionEventInvokeConfig",
        "lambda:ListTags",
        "lambda:TagResource",
        "lambda:UntagResource"
      ],
      "Resource": [
        "arn:aws:lambda:$Region`:$AccountId`:function:$StackName-*",
        "arn:aws:lambda:$Region`:$AccountId`:function:$StackName-*:*"
      ]
    },
    {
      "Sid": "FunctionRoles",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:GetRole",
        "iam:PassRole",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:GetRolePolicy",
        "iam:ListRolePolicies",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:ListAttachedRolePolicies",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:UpdateAssumeRolePolicy"
      ],
      "Resource": [ "arn:aws:iam::$AccountId`:role/$StackName-*" ]
    },
    {
      "Sid": "HttpApi",
      "Effect": "Allow",
      "Action": "apigateway:*",
      "Resource": "*"
    },
    {
      "Sid": "Schedules",
      "Effect": "Allow",
      "Action": [
        "events:PutRule",
        "events:DescribeRule",
        "events:DeleteRule",
        "events:PutTargets",
        "events:RemoveTargets",
        "events:ListTargetsByRule",
        "events:ListRules",
        "events:TagResource",
        "events:UntagResource",
        "events:ListTagsForResource"
      ],
      "Resource": [ "arn:aws:events:$Region`:$AccountId`:rule/$StackName-*" ]
    }
  ]
}
"@
    $PolicyFile = Join-Path $TempDir 'deploy-policy.json'
    Set-Content -Path $PolicyFile -Value $Policy -Encoding ascii

    Write-Host '==> Applying the deploy role policy' -ForegroundColor Cyan
    & aws iam put-role-policy `
        --role-name $RoleName `
        --policy-name 'StockSureLambdaDeploy' `
        --policy-document "file://$PolicyFile"
    if ($LASTEXITCODE -ne 0) { throw 'Could not apply the deploy role policy.' }

    Write-Host ''
    Write-Host "Deploy role ARN: $RoleArn" -ForegroundColor Green

    if ($ConfigureRepo) {
        if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
            Write-Host 'gh is not installed; set the repository variable manually:' -ForegroundColor Yellow
            Write-Host "  gh variable set AWS_DEPLOY_ROLE_ARN --body `"$RoleArn`" --repo $GitHubRepo"
        } else {
            Write-Host "==> Setting AWS_DEPLOY_ROLE_ARN on $GitHubRepo" -ForegroundColor Cyan
            & gh variable set AWS_DEPLOY_ROLE_ARN --body $RoleArn --repo $GitHubRepo
            if ($LASTEXITCODE -ne 0) { throw 'Could not set the repository variable.' }
        }
    } else {
        Write-Host 'Next: set the repository variable used by the workflow:' -ForegroundColor Yellow
        Write-Host "  gh variable set AWS_DEPLOY_ROLE_ARN --body `"$RoleArn`" --repo $GitHubRepo"
    }
} finally {
    Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
}
