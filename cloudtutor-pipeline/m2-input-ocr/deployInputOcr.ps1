& {
    $ErrorActionPreference = "Stop"
    $CtPayload = $PSScriptRoot
    $CtProject = Split-Path $CtPayload -Parent
    Set-Location $CtProject
    $env:AWS_PROFILE = "new"
    $env:AWS_REGION = "ap-southeast-1"
    $env:AWS_CLI_FILE_ENCODING = "UTF-8"
    $env:PYTHONUTF8 = "1"
    $env:PYTHONIOENCODING = "utf-8"
    $CtUtf8 = New-Object System.Text.UTF8Encoding($false)
    $CtBucket = "s3-cloudtutor-media-251929332061"
    $CtMainWorker = "lambda-cloudtutor-start-transcription"
    $CtMainOcr = "lambda-cloudtutor-process-frames"
    $CtIntegration = Get-Content .\pipeline-integration-test-resources.json -Raw | ConvertFrom-Json
    $CtTestWorker = $CtIntegration.worker_function
    if ($CtTestWorker -notlike "lambda-cloudtutor-test-*") { throw "Expected test worker." }
    $CtStamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $CtBackup = Join-Path $CtProject "local-input-ocr-backups\$CtStamp"
    $CtBuild = Join-Path $CtProject "local-input-ocr-build\$CtStamp"
    $CtReport = Join-Path $CtProject "reports\input-ocr\$CtStamp"
    foreach ($CtDir in @($CtBackup, $CtBuild, $CtReport)) { New-Item -ItemType Directory -Path $CtDir -Force | Out-Null }
    function Write-CtJson {
        param($Value, [string]$Path)
        $CtAbsolute = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
        [System.IO.File]::WriteAllText($CtAbsolute, (ConvertTo-Json -InputObject $Value -Depth 50 -Compress), $CtUtf8)
    }
    function Invoke-CtAws {
        param([string[]]$Arguments)
        $CtOut = & aws @Arguments --region ap-southeast-1 --profile new --output json --no-cli-pager
        if ($LASTEXITCODE -ne 0) { throw "AWS failed: $($Arguments[0]) $($Arguments[1])" }
        if ($CtOut) { return ($CtOut | ConvertFrom-Json) }
    }
    function Wait-CtLambda {
        param([string]$Name)
        aws lambda wait function-updated-v2 --function-name $Name --region ap-southeast-1 --profile new
        if ($LASTEXITCODE -ne 0) { throw "Lambda update did not complete: $Name" }
    }
    function Set-CtTestEnvironment {
        param($Variables)
        $CtTemp = Join-Path $env:TEMP ("ct-input-env-" + [guid]::NewGuid().ToString("N") + ".json")
        try {
            Write-CtJson @{ FunctionName = $CtTestWorker; Environment = @{ Variables = $Variables } } $CtTemp
            $null = Invoke-CtAws -Arguments @("lambda", "update-function-configuration", "--cli-input-json", "file://$CtTemp", "--query", "{Name:FunctionName,Update:LastUpdateStatus}")
        }
        finally { if (Test-Path $CtTemp) { Remove-Item $CtTemp -Force } }
        Wait-CtLambda $CtTestWorker
    }
    function Deploy-CtCode {
        param([string]$Name, [string]$Zip)
        $CtRevision = Invoke-CtAws -Arguments @("lambda", "get-function-configuration", "--function-name", $Name, "--query", "RevisionId")
        $null = Invoke-CtAws -Arguments @("lambda", "update-function-code", "--function-name", $Name, "--revision-id", $CtRevision, "--zip-file", "fileb://$Zip", "--query", "{Name:FunctionName,Update:LastUpdateStatus}")
        Wait-CtLambda $Name
    }
    Write-Host "`n========== 1. PREFLIGHT AND BACKUP =========="
    $CtIdentity = Invoke-CtAws -Arguments @("sts", "get-caller-identity")
    if ($CtIdentity.Account -ne "251929332061") { throw "Wrong AWS account." }
    $CtConfigs = @{}
    foreach ($CtName in @($CtMainWorker, $CtMainOcr, $CtTestWorker)) {
        $CtConfig = Invoke-CtAws -Arguments @("lambda", "get-function-configuration", "--function-name", $CtName)
        if ($CtConfig.Runtime -ne "nodejs22.x" -or $CtConfig.State -ne "Active" -or $CtConfig.LastUpdateStatus -eq "InProgress") { throw "Unexpected Lambda state/runtime: $CtName" }
        if ($CtConfig.Environment.Variables.MEDIA_BUCKET -ne $CtBucket) { throw "Unexpected media bucket: $CtName" }
        if (@($CtConfig.Layers | Where-Object { $_.Arn -like "*:layer:cloudtutor-node22-dependencies:*" }).Count -ne 1) { throw "Expected SDK Layer: $CtName" }
        $CtConfigs[$CtName] = $CtConfig
        $CtFunction = Invoke-CtAws -Arguments @("lambda", "get-function", "--function-name", $CtName)
        Invoke-WebRequest -Uri $CtFunction.Code.Location -UseBasicParsing -OutFile (Join-Path $CtBackup "$CtName.zip")
        Write-CtJson @{ function_name = $CtName; handler = $CtConfig.Handler; code_hash = $CtConfig.CodeSha256; layers = @($CtConfig.Layers | ForEach-Object { $_.Arn }) } (Join-Path $CtBackup "$CtName.json")
    }
    if ($CtConfigs[$CtMainWorker].Environment.Variables.INPUT_VIDEO_PREFIX -and $CtConfigs[$CtMainWorker].Environment.Variables.INPUT_VIDEO_PREFIX -ne "videos") { throw "Unexpected main input prefix." }
    $CtMappings = Invoke-CtAws -Arguments @("lambda", "list-event-source-mappings", "--function-name", $CtTestWorker)
    if (@($CtMappings.EventSourceMappings | Where-Object { $_.State -ne "Disabled" }).Count -gt 0) { throw "Test worker has active event consumers; do not temporarily repurpose it." }
    $CtNotification = Invoke-CtAws -Arguments @("s3api", "get-bucket-notification-configuration", "--bucket", $CtBucket)
    foreach ($CtNotificationItem in @($CtNotification.QueueConfigurations) + @($CtNotification.LambdaFunctionConfigurations) + @($CtNotification.TopicConfigurations)) {
        if (-not $CtNotificationItem) { continue }
        $CtPrefixes = @($CtNotificationItem.Filter.Key.FilterRules | Where-Object { $_.Name -eq "Prefix" } | ForEach-Object { $_.Value })
        if ($CtPrefixes.Count -eq 0 -or @($CtPrefixes | Where-Object { "m2-input-tests/test-user/fixture/source.mp4".StartsWith($_) }).Count -gt 0) { throw "S3 notification may consume isolated guard fixtures; review routing." }
    }
    foreach ($CtFile in @("index.js", "onFramesReady.js")) { Copy-Item $CtFile (Join-Path $CtBackup $CtFile) }

    Write-Host "`n========== 2. PATCH AND LOCAL TESTS =========="
    node (Join-Path $CtPayload "patchProject.js") $CtProject
    if ($LASTEXITCODE -ne 0) { throw "Source patch failed. No function code changed on AWS." }
    node .\testInputOcr.js
    if ($LASTEXITCODE -ne 0) { throw "Input/OCR tests failed." }
    node .\testWorkerInput.js
    if ($LASTEXITCODE -ne 0) { throw "Worker handler tests failed." }
    foreach ($CtName in @("worker", "ocr")) {
        $CtEntry = if ($CtName -eq "worker") { "index.js" } else { "onFramesReady.js" }
        $CtStage = Join-Path $CtBuild $CtName
        node (Join-Path $CtPayload "buildPackage.js") $CtProject $CtEntry $CtStage
        if ($LASTEXITCODE -ne 0) { throw "Package failed: $CtName" }
        Compress-Archive -Path (Join-Path $CtStage "*") -DestinationPath (Join-Path $CtBuild "$CtName.zip") -Force
    }

    Write-Host "`n========== 3. SCOPED S3 READ POLICY =========="
    $CtRoles = @(@($CtConfigs[$CtMainWorker].Role, $CtConfigs[$CtTestWorker].Role) | ForEach-Object { ($_ -split "/")[-1] } | Select-Object -Unique)
    $CtPolicy = @{ AWSTemplateFormatVersion = "2010-09-09"; Resources = @{ InputReadPolicy = @{ Type = "AWS::IAM::Policy"; Properties = @{
        PolicyName = "cloudtutor-input-validation-read"; Roles = $CtRoles; PolicyDocument = @{ Version = "2012-10-17"; Statement = @(@{
            Effect = "Allow"; Action = @("s3:GetObject"); Resource = @("arn:aws:s3:::$CtBucket/videos/*", "arn:aws:s3:::$CtBucket/m2-input-tests/*")
        }) }
    } } } }
    $CtPolicyPath = Join-Path $CtProject "input-validation-stack.json"
    Write-CtJson $CtPolicy $CtPolicyPath
    aws cloudformation deploy --template-file $CtPolicyPath --stack-name cloudtutor-input-validation --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset --region ap-southeast-1 --profile new
    if ($LASTEXITCODE -ne 0) { throw "Input read policy deployment failed." }
    node (Join-Path $CtPayload "validateStoredVideo.js") (Join-Path $CtReport "stored-mp4-check.json")
    if ($LASTEXITCODE -ne 0) { throw "Actual stored-video check failed. Main code not deployed." }

    Write-Host "`n========== 4. ISOLATED INVALID-INPUT AWS TEST =========="
    $CtOriginalEnv = @{}
    foreach ($CtProperty in $CtConfigs[$CtTestWorker].Environment.Variables.PSObject.Properties) { $CtOriginalEnv[$CtProperty.Name] = [string]$CtProperty.Value }
    $CtTestEnv = $CtOriginalEnv.Clone()
    $CtTestEnv["INPUT_VIDEO_PREFIX"] = "m2-input-tests"
    $CtTestChanged = $false
    $CtResults = @()
    try {
        $CtTestChanged = $true
        Set-CtTestEnvironment $CtTestEnv
        Deploy-CtCode $CtTestWorker (Join-Path $CtBuild "worker.zip")
        foreach ($CtCase in @(@{ Name = "empty"; Body = ""; Error = "VIDEO_EMPTY_OR_INVALID_SIZE" }, @{ Name = "renamed-text"; Body = "This is not an MP4 container."; Error = "VIDEO_INVALID_MP4_HEADER" })) {
            $CtJob = "input-guard-test-" + [guid]::NewGuid().ToString("N")
            $CtKey = "m2-input-tests/test-user/$CtJob/source.mp4"
            $CtObjectPath = Join-Path $CtBuild "$CtJob.mp4"
            [System.IO.File]::WriteAllText($CtObjectPath, $CtCase.Body, $CtUtf8)
            $CtPut = Invoke-CtAws -Arguments @("s3api", "put-object", "--bucket", $CtBucket, "--key", $CtKey, "--body", $CtObjectPath, "--content-type", "video/mp4")
            $CtItem = @{ job_id = @{ S = $CtJob }; owner_id = @{ S = "test-user" }; video_key = @{ S = $CtKey }; status = @{ S = "UPLOADED" }; test_fixture = @{ BOOL = $true }; updated_at = @{ S = [DateTime]::UtcNow.ToString("o") } }
            $CtItemPath = Join-Path $CtReport "$CtJob-item.json"
            Write-CtJson $CtItem $CtItemPath
            $null = Invoke-CtAws -Arguments @("dynamodb", "put-item", "--table-name", "ddb-cloudtutor-jobs", "--item", "file://$CtItemPath", "--condition-expression", "attribute_not_exists(job_id)")
            $CtInner = @{ Records = @(@{ s3 = @{ bucket = @{ name = $CtBucket }; object = @{ key = $CtKey; eTag = $CtPut.ETag.Trim('"') } } }) }
            $CtEvent = @{ Records = @(@{ body = (ConvertTo-Json -InputObject $CtInner -Depth 10 -Compress) }) }
            $CtEventPath = Join-Path $CtReport "$CtJob-event.json"
            $CtResponsePath = Join-Path $CtReport "$CtJob-response.json"
            Write-CtJson $CtEvent $CtEventPath
            $CtInvoke = Invoke-CtAws -Arguments @("lambda", "invoke", "--function-name", $CtTestWorker, "--cli-binary-format", "raw-in-base64-out", "--payload", "file://$CtEventPath", "--log-type", "Tail", $CtResponsePath)
            if ($CtInvoke.LogResult) { [System.IO.File]::WriteAllText((Join-Path $CtReport "$CtJob-log.txt"), [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($CtInvoke.LogResult)), $CtUtf8) }
            if ($CtInvoke.FunctionError) { throw "Test worker returned FunctionError. Main not deployed." }
            $CtKeyPath = Join-Path $CtReport "$CtJob-key.json"
            Write-CtJson @{ job_id = @{ S = $CtJob } } $CtKeyPath
            $CtAfter = Invoke-CtAws -Arguments @("dynamodb", "get-item", "--table-name", "ddb-cloudtutor-jobs", "--key", "file://$CtKeyPath", "--consistent-read")
            Write-CtJson $CtAfter (Join-Path $CtReport "$CtJob-after.json")
            if ($CtAfter.Item.status.S -ne "FAILED" -or $CtAfter.Item.error_code.S -ne $CtCase.Error -or $CtAfter.Item.transcription_job_name) { throw "Unexpected invalid-input state. Main not deployed." }
            Write-Host "PASS AWS:" $CtCase.Name "-> FAILED /" $CtCase.Error
            $CtResults += @{ case = $CtCase.Name; job_id = $CtJob; error_code = $CtCase.Error }
        }
    }
    finally {
        if ($CtTestChanged) {
            Write-Host "RESTORING: previous test worker code and environment."
            Deploy-CtCode $CtTestWorker (Join-Path $CtBackup "$CtTestWorker.zip")
            Set-CtTestEnvironment $CtOriginalEnv
        }
    }

    Write-Host "`n========== 5. MAIN WORKER / OCR DEPLOY =========="
    Write-Host "No new uploads until both deployments finish. Vision is unchanged."
    Deploy-CtCode $CtMainWorker (Join-Path $CtBuild "worker.zip")
    Deploy-CtCode $CtMainOcr (Join-Path $CtBuild "ocr.zip")
    foreach ($CtFunctionName in @($CtMainWorker, $CtMainOcr)) {
        $CtSmoke = if ($CtFunctionName -eq $CtMainWorker) { @{ Records = @(@{ body = '{"Event":"s3:TestEvent"}' }) } } else { @{ detail = @{ userMetadata = @{ project = "input-ocr-import-check" } } } }
        $CtEventFile = Join-Path $CtReport "$CtFunctionName-smoke.json"
        Write-CtJson $CtSmoke $CtEventFile
        $CtSmokeResult = Invoke-CtAws -Arguments @("lambda", "invoke", "--function-name", $CtFunctionName, "--cli-binary-format", "raw-in-base64-out", "--payload", "file://$CtEventFile", (Join-Path $CtReport "$CtFunctionName-response.json"))
        if ($CtSmokeResult.FunctionError) { throw "Main import check failed. Keep backup and report." }
        Write-Host "PASS IMPORT:" $CtFunctionName
    }
    Write-CtJson @{ deployed_at = [DateTime]::UtcNow.ToString("o"); max_video_bytes = 500000000; container_check = "FTYP_ONLY"; invalid_input_cases = $CtResults; test_worker_restored = $true; backup = $CtBackup } (Join-Path $CtReport "deployment.json")

    Write-Host "`n========== 6. OCR LANGUAGE EVALUATION =========="
    $CtOcrReport = Join-Path $CtReport "ocr-language"
    & (Join-Path $CtPayload "createOcrImages.ps1") -Destination $CtOcrReport
    node .\ocrEvaluation.js $CtOcrReport
    if ($LASTEXITCODE -ne 0) { throw "OCR evaluation stopped. Worker/OCR deploy passed; do not rerun the entire deployment. Send this report path." }
    Write-Host "`nPASS: INPUT VALIDATION DEPLOYED; OCR PROBE COMPLETED."
    Write-Host "Reports:" $CtReport
    Write-Host "Backups:" $CtBackup
    Write-Host "500 MB boundary used mocks; no 500 MB upload. Actual AWS rejection tested on two small fixtures."
    Write-Host "OCR quality is measured, not assumed. Send ocr-language\evaluation.json."
}
