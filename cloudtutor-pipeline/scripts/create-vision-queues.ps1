param(
    [string]$Region = "ap-southeast-1",
    [string]$Profile = "new"
)

$ErrorActionPreference = "Stop"

function Invoke-CtAwsJson {
    param(
        [string[]]$AwsArguments
    )

    $CtRawOutput = & aws @AwsArguments `
        --region $Region `
        --profile $Profile `
        --output json `
        --no-cli-pager

    if ($LASTEXITCODE -ne 0) {
        throw "Lenh AWS that bai; dung script."
    }

    return ($CtRawOutput | ConvertFrom-Json)
}

$CtIdentity = Invoke-CtAwsJson -AwsArguments @(
    "sts", "get-caller-identity"
)

if ($CtIdentity.Account -ne "251929332061") {
    throw "Dang dung sai tai khoan AWS"
}

# File cấu hình không chứa API key.
$CtUtf8 = New-Object System.Text.UTF8Encoding($false)

$CtDlqAttributesPath = Join-Path $PSScriptRoot "vision-dlq-attributes.json"
$CtQueueAttributesPath = Join-Path $PSScriptRoot "vision-queue-attributes.json"

$CtDlqAttributes = @{
    MessageRetentionPeriod = "1209600"
    SqsManagedSseEnabled = "true"
}

[System.IO.File]::WriteAllText(
    $CtDlqAttributesPath,
    ($CtDlqAttributes | ConvertTo-Json),
    $CtUtf8
)

# 1. Tạo DLQ: giữ message tối đa 14 ngày.
$CtDlq = Invoke-CtAwsJson -AwsArguments @(
    "sqs", "create-queue",
    "--queue-name", "sqs-cloudtutor-vision-dlq",
    "--attributes", "file://$CtDlqAttributesPath"
)

Start-Sleep -Seconds 2

$CtDlqDetails = Invoke-CtAwsJson -AwsArguments @(
    "sqs", "get-queue-attributes",
    "--queue-url", $CtDlq.QueueUrl,
    "--attribute-names", "QueueArn"
)

$CtVisionDlqArn = $CtDlqDetails.Attributes.QueueArn

# RedrivePolicy phải là một chuỗi JSON bên trong map attributes.
$CtRedrivePolicy = @{
    deadLetterTargetArn = $CtVisionDlqArn
    maxReceiveCount = 5
} | ConvertTo-Json -Compress

$CtQueueAttributes = @{
    VisibilityTimeout = "1800"
    MessageRetentionPeriod = "345600"
    ReceiveMessageWaitTimeSeconds = "20"
    SqsManagedSseEnabled = "true"
    RedrivePolicy = $CtRedrivePolicy
}

[System.IO.File]::WriteAllText(
    $CtQueueAttributesPath,
    ($CtQueueAttributes | ConvertTo-Json -Depth 5),
    $CtUtf8
)

# 2. Tạo queue chính: giữ message tối đa 4 ngày.
$CtQueue = Invoke-CtAwsJson -AwsArguments @(
    "sqs", "create-queue",
    "--queue-name", "sqs-cloudtutor-vision-processing",
    "--attributes", "file://$CtQueueAttributesPath"
)

Start-Sleep -Seconds 2

$CtQueueDetails = Invoke-CtAwsJson -AwsArguments @(
    "sqs", "get-queue-attributes",
    "--queue-url", $CtQueue.QueueUrl,
    "--attribute-names",
    "QueueArn",
    "VisibilityTimeout",
    "MessageRetentionPeriod",
    "RedrivePolicy"
)

# Lưu riêng tài nguyên Vision; chưa sửa resource-map hiện có.
$CtVisionResources = @{
    region = $Region
    account_id = $CtIdentity.Account
    vision_queue_url = $CtQueue.QueueUrl
    vision_queue_arn = $CtQueueDetails.Attributes.QueueArn
    vision_dlq_url = $CtDlq.QueueUrl
    vision_dlq_arn = $CtVisionDlqArn
}

$CtResourcesPath = Join-Path $PSScriptRoot "vision-resources.json"

[System.IO.File]::WriteAllText(
    $CtResourcesPath,
    ($CtVisionResources | ConvertTo-Json -Depth 5),
    $CtUtf8
)

Write-Host "`nDa tao/kiem tra hai queue Vision." -ForegroundColor Green

$CtVisionResources | Format-List
$CtQueueDetails.Attributes | Format-List

Write-Host "Da luu: $CtResourcesPath"