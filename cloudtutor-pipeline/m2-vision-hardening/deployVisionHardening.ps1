& {
    $ErrorActionPreference = "Stop"
    $CtPayload = $PSScriptRoot
    $CtProject = Split-Path $CtPayload -Parent
    Set-Location $CtProject
    if (-not (Test-Path ".\onVisionFallback.js")) {
        throw "Extract m2-vision-hardening into cloudtutor-pipeline, then run this script."
    }
    $env:AWS_CLI_FILE_ENCODING = "UTF-8"
    $env:PYTHONUTF8 = "1"
    $env:PYTHONIOENCODING = "utf-8"
    $CtUtf8 = New-Object System.Text.UTF8Encoding($false)
    $CtBucket = "s3-cloudtutor-media-251929332061"
    $CtSecretName = "cloudtutor/dev/gemini-api-key"
    $CtTable = "ddb-cloudtutor-vision-runtime"
    $CtMain = "lambda-cloudtutor-vision-fallback"
    $CtTestResource = Get-Content .\vision-usefulness-test-resources.json -Raw | ConvertFrom-Json
    $CtIntegration = Get-Content .\pipeline-integration-test-resources.json -Raw | ConvertFrom-Json
    $CtTest = $CtTestResource.function_name
    if ($CtTest -notlike "lambda-cloudtutor-test-*") { throw "Expected a test Lambda." }

    function Invoke-CtAws {
        param([string[]]$Arguments)
        $CtOutput = & aws @Arguments --region ap-southeast-1 --profile new --output json --no-cli-pager
        if ($LASTEXITCODE -ne 0) { throw "AWS failed: $($Arguments[0]) $($Arguments[1])" }
        if ($CtOutput) { return ($CtOutput | ConvertFrom-Json) }
    }
    function Write-CtJson {
        param($Value, [string]$Path)
        $CtAbsolute = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
        [System.IO.File]::WriteAllText($CtAbsolute, (ConvertTo-Json -InputObject $Value -Depth 60 -Compress), $CtUtf8)
    }
    function Get-CtConfig {
        param([string]$Name)
        return Invoke-CtAws -Arguments @("lambda", "get-function-configuration", "--function-name", $Name)
    }
    function Wait-CtFunction {
        param([string]$Name)
        aws lambda wait function-updated-v2 --function-name $Name --region ap-southeast-1 --profile new
        if ($LASTEXITCODE -ne 0) { throw "Lambda update failed: $Name" }
    }
    function Set-CtVisionConfig {
        param([string]$Name, [switch]$RemoveEnvironmentKey)
        $CtConfig = Get-CtConfig $Name
        $CtVariables = @{}
        foreach ($CtProperty in $CtConfig.Environment.Variables.PSObject.Properties) {
            $CtVariables[$CtProperty.Name] = [string]$CtProperty.Value
        }
        $CtVariables["GEMINI_SECRET_ID"] = $CtSecretArn
        $CtVariables["GEMINI_QUOTA_TABLE"] = $CtTable
        $CtVariables["GEMINI_PROMPT_VERSION"] = "vision-v2"
        $CtVariables["VISION_ALLOWED_QUEUE_ARNS"] = ($CtQueueArns -join ",")
        if ($RemoveEnvironmentKey) { $CtVariables.Remove("GEMINI_API_KEY") }
        $CtLayers = @($CtConfig.Layers | ForEach-Object { $_.Arn } | Where-Object {
            $_ -and $_ -notlike "*:layer:cloudtutor-node22-dependencies:*"
        })
        $CtLayers += $CtLayerArn
        if ($CtLayers.Count -gt 5) { throw "Too many layers." }
        $CtRequest = @{ FunctionName = $Name; RevisionId = $CtConfig.RevisionId
            Layers = @($CtLayers); Environment = @{ Variables = $CtVariables } }
        $CtTemp = Join-Path $env:TEMP ("ct-private-config-" + [guid]::NewGuid().ToString("N") + ".json")
        try {
            Write-CtJson $CtRequest $CtTemp
            $null = Invoke-CtAws -Arguments @("lambda", "update-function-configuration", "--cli-input-json", "file://$CtTemp", "--query", "{Name:FunctionName,Update:LastUpdateStatus}")
        }
        finally { if (Test-Path $CtTemp) { Remove-Item $CtTemp -Force } }
        Wait-CtFunction $Name
    }
    function Deploy-CtVisionCode {
        param([string]$Name)
        Set-CtVisionConfig $Name
        $CtCurrent = Get-CtConfig $Name
        $null = Invoke-CtAws -Arguments @("lambda", "update-function-code", "--function-name", $Name,
            "--revision-id", $CtCurrent.RevisionId, "--zip-file", "fileb://$CtCodeZip", "--query", "{Name:FunctionName,Update:LastUpdateStatus}")
        Wait-CtFunction $Name
    }
    function Invoke-CtVision {
        param([string]$Name, $Event, [string]$Label)
        $CtEventFile = Join-Path $CtReport "$Label-event.json"
        $CtResponseFile = Join-Path $CtReport "$Label-response.json"
        Write-CtJson $Event $CtEventFile
        $CtInvoke = Invoke-CtAws -Arguments @("lambda", "invoke", "--function-name", $Name,
            "--cli-binary-format", "raw-in-base64-out", "--payload", "file://$CtEventFile",
            "--cli-read-timeout", "320", "--log-type", "Tail", $CtResponseFile)
        if ($CtInvoke.LogResult) {
            $CtLogs = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($CtInvoke.LogResult))
            [System.IO.File]::WriteAllText((Join-Path $CtReport "$Label-log.txt"), $CtLogs, $CtUtf8)
            Write-Host $CtLogs
        }
        $CtText = Get-Content $CtResponseFile -Raw -Encoding UTF8
        Write-Host $CtText
        if ($CtInvoke.FunctionError) { throw "Vision invocation failed. Keep reports; do not recreate the fixture or rerun the entire script." }
        return ($CtText | ConvertFrom-Json)
    }

    $CtAccount = Invoke-CtAws -Arguments @("sts", "get-caller-identity")
    if ($CtAccount.Account -ne "251929332061") { throw "Wrong AWS account." }
    $CtRun = Get-Date -Format "yyyyMMdd-HHmmss"
    $CtReport = Join-Path $CtProject "reports\vision-hardening\$CtRun"
    $CtBackup = Join-Path $CtProject "local-vision-hardening-backups\$CtRun"
    New-Item -ItemType Directory -Path $CtReport, $CtBackup -Force | Out-Null
    $CtConfigs = @{}
    $CtQueueArns = @()

    Write-Host "`n========== 1. PREFLIGHT AND BACKUP =========="
    foreach ($CtName in @($CtTest, $CtMain)) {
        $CtConfig = Get-CtConfig $CtName
        if ($CtConfig.Runtime -ne "nodejs22.x" -or $CtConfig.Architectures -notcontains "x86_64" -or $CtConfig.Timeout -ne 300) {
            throw "Expected Node22/x86_64 with 300-second timeout."
        }
        if (@($CtConfig.VpcConfig.SubnetIds | Where-Object { $_ }).Count -gt 0) { throw "VPC changed; review Secrets Manager and outbound network before continuing." }
        if ($CtConfig.Environment.Variables.AI_QUEUE_URL -ne $CtIntegration.ai_test_queue_url) {
            throw "Vision AI queue changed; this rollout expects the existing test handoff destination."
        }
        $CtConfigs[$CtName] = $CtConfig
        $CtFunction = Invoke-CtAws -Arguments @("lambda", "get-function", "--function-name", $CtName)
        $CtOldZip = Join-Path $CtBackup "$CtName-before.zip"
        Invoke-WebRequest -Uri $CtFunction.Code.Location -OutFile $CtOldZip -UseBasicParsing
        Write-CtJson @{ function_name = $CtName; handler = $CtConfig.Handler
            layers = @($CtConfig.Layers | ForEach-Object { $_.Arn }); code_zip = $CtOldZip
            old_secret_id = $CtConfig.Environment.Variables.GEMINI_SECRET_ID
            old_model = $CtConfig.Environment.Variables.GEMINI_MODEL
        } (Join-Path $CtBackup "$CtName-before.json")
        $CtMappings = Invoke-CtAws -Arguments @("lambda", "list-event-source-mappings", "--function-name", $CtName)
        foreach ($CtMapping in $CtMappings.EventSourceMappings) {
            if ($CtMapping.EventSourceArn -like "arn:aws:sqs:ap-southeast-1:251929332061:*") {
                if ($CtMapping.BatchSize -ne 1) { throw "This rollout requires SQS batch size 1." }
                $CtQueueArns += $CtMapping.EventSourceArn
            }
        }
    }
    $CtQueueArns = @($CtQueueArns | Sort-Object -Unique)
    if ($CtQueueArns.Count -lt 2) { throw "Expected main and test Vision SQS mappings." }
    foreach ($CtFile in @("geminiVision.js", "geminiRetry.js", "onVisionFallback.js", "recoveryRules.js", "reconcileRealJobs.js", "deployRealRecovery.ps1", "testGeminiRetry.js")) {
        if (-not (Test-Path ".\$CtFile")) { throw "Missing project file: $CtFile" }
        Copy-Item ".\$CtFile" $CtBackup -Force
    }

    Write-Host "`n========== 2. PATCH AND LOCAL TESTS =========="
    node (Join-Path $CtPayload "patchProject.js") $CtProject
    if ($LASTEXITCODE -ne 0) { throw "Patch anchors did not match; send the error. No AWS configuration changed." }
    node .\testVisionHardening.js
    if ($LASTEXITCODE -ne 0) { throw "Hardening tests failed; do not deploy." }
    node .\testRecoveryRules.js
    if ($LASTEXITCODE -ne 0) { throw "Recovery regression tests failed." }
    node .\testVisionQuotaRecovery.js
    if ($LASTEXITCODE -ne 0) { throw "Due-quota recovery tests failed." }
    foreach ($CtFile in @("onVisionFallback.js", "reconcileRealJobs.js", "recoveryRules.js")) {
        node --check ".\$CtFile"
        if ($LASTEXITCODE -ne 0) { throw "Syntax error: $CtFile" }
    }

    Write-Host "`n========== 3. CREATE SECRET WITHOUT PRINTING KEY =========="
    $CtSecrets = Invoke-CtAws -Arguments @("secretsmanager", "list-secrets", "--filters", "Key=name,Values=$CtSecretName")
    $CtMatches = @($CtSecrets.SecretList | Where-Object { $_.Name -eq $CtSecretName })
    if ($CtMatches.Count -gt 1) { throw "Ambiguous secret metadata." }
    if ($CtMatches.Count -eq 0) {
        $CtKeyValue = $CtConfigs[$CtMain].Environment.Variables.GEMINI_API_KEY
        if (-not $CtKeyValue -or $CtKeyValue.Length -lt 16) { throw "No existing Lambda key available to migrate. Do not paste a key into chat." }
        $CtPrivate = Join-Path $env:TEMP ("ct-private-secret-" + [guid]::NewGuid().ToString("N") + ".json")
        try {
            Write-CtJson @{ Name = $CtSecretName; SecretString = (@{ api_key = $CtKeyValue } | ConvertTo-Json -Compress) } $CtPrivate
            $CtCreated = Invoke-CtAws -Arguments @("secretsmanager", "create-secret", "--cli-input-json", "file://$CtPrivate", "--query", "{Name:Name,ARN:ARN}")
            $CtSecretArn = $CtCreated.ARN
        }
        finally {
            $CtKeyValue = $null
            if (Test-Path $CtPrivate) { Remove-Item $CtPrivate -Force }
        }
    } else { $CtSecretArn = $CtMatches[0].ARN }
    $CtSecretMetadata = Invoke-CtAws -Arguments @("secretsmanager", "describe-secret", "--secret-id", $CtSecretArn, "--query", "{Name:Name,ARN:ARN,KmsKeyId:KmsKeyId}")
    Write-CtJson $CtSecretMetadata (Join-Path $CtReport "secret-metadata.json")
    Write-Host "Secret ready:" $CtSecretMetadata.Name
    Write-Host "No secret value printed. Existing secret was not overwritten."

    Write-Host "`n========== 4. BUILD NEW SDK LAYER =========="
    $CtBuild = Join-Path $CtProject "local-vision-hardening-build"
    $CtNodejs = Join-Path $CtBuild "nodejs"
    New-Item -ItemType Directory -Path $CtNodejs -Force | Out-Null
    $CtLayerManifestDir = Join-Path $CtProject "infra\vision-runtime-layer"
    New-Item -ItemType Directory -Path $CtLayerManifestDir -Force | Out-Null
    if (-not (Test-Path (Join-Path $CtNodejs "package-lock.json"))) {
        $CtSecretSdkVersion = (& npm view "@aws-sdk/client-secrets-manager" version | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or $CtSecretSdkVersion -notmatch '^\d+\.\d+\.\d+$') { throw "Cannot resolve Secrets Manager SDK." }
        # Node parses npm lockfiles safely, including the empty root-package key.
        node (Join-Path $CtPayload "makeLayerPackage.js") $CtProject $CtSecretSdkVersion (Join-Path $CtNodejs "package.json")
        if ($LASTEXITCODE -ne 0) { throw "Cannot prepare pinned Layer package." }
        & npm install --prefix $CtNodejs --omit=dev
    } else { & npm ci --prefix $CtNodejs --omit=dev }
    if ($LASTEXITCODE -ne 0) { throw "Layer installation failed." }
    if (@(Get-ChildItem (Join-Path $CtNodejs "node_modules") -Recurse -Filter "*.node" -File).Count -gt 0) {
        throw "Native dependency found. Build this layer on Linux rather than packaging Windows binaries."
    }
    Copy-Item (Join-Path $CtNodejs "package.json"), (Join-Path $CtNodejs "package-lock.json") $CtLayerManifestDir -Force
    $CtLayerZip = Join-Path $CtBuild "vision-runtime-layer.zip"
    Compress-Archive -Path $CtNodejs -DestinationPath $CtLayerZip -Force
    $CtLayer = Invoke-CtAws -Arguments @("lambda", "publish-layer-version", "--layer-name", "cloudtutor-node22-dependencies",
        "--zip-file", "fileb://$CtLayerZip", "--compatible-runtimes", "nodejs22.x", "--compatible-architectures", "x86_64",
        "--description", "Pinned AWS SDKs including Secrets Manager for Vision")
    $CtLayerArn = $CtLayer.LayerVersionArn
    if (-not $CtLayerArn) { throw "Missing published Layer ARN." }
    Write-CtJson @{ layer_arn = $CtLayerArn; prepared_at = [DateTime]::UtcNow.ToString("o") } (Join-Path $CtLayerManifestDir "release.json")
    Write-Host "New layer:" $CtLayerArn

    Write-Host "`n========== 5. IAM, COOLDOWN TABLE AND ALARMS =========="
    $CtRoles = @($CtConfigs.Values | ForEach-Object { ($_.Role -split "/")[-1] } | Sort-Object -Unique)
    $CtStatements = @(
        @{ Effect = "Allow"; Action = "secretsmanager:GetSecretValue"; Resource = $CtSecretArn }
        @{ Effect = "Allow"; Action = @("dynamodb:GetItem", "dynamodb:UpdateItem"); Resource = "arn:aws:dynamodb:ap-southeast-1:251929332061:table/$CtTable" }
        @{ Effect = "Allow"; Action = @("dynamodb:GetItem", "dynamodb:UpdateItem"); Resource = "arn:aws:dynamodb:ap-southeast-1:251929332061:table/ddb-cloudtutor-jobs" }
        @{ Effect = "Allow"; Action = "sqs:ChangeMessageVisibility"; Resource = @($CtQueueArns) }
    )
    if ($CtSecretMetadata.KmsKeyId -and $CtSecretMetadata.KmsKeyId -ne "alias/aws/secretsmanager") {
        $CtKms = Invoke-CtAws -Arguments @("kms", "describe-key", "--key-id", $CtSecretMetadata.KmsKeyId, "--query", "KeyMetadata.Arn")
        $CtStatements += @{ Effect = "Allow"; Action = "kms:Decrypt"; Resource = [string]$CtKms
            Condition = @{ StringEquals = @{ "kms:ViaService" = "secretsmanager.ap-southeast-1.amazonaws.com" } } }
    }
    $CtResources = @{
        QuotaTable = @{ Type = "AWS::DynamoDB::Table"; Properties = @{
            TableName = $CtTable; BillingMode = "PAY_PER_REQUEST"
            AttributeDefinitions = @(@{ AttributeName = "control_key"; AttributeType = "S" })
            KeySchema = @(@{ AttributeName = "control_key"; KeyType = "HASH" })
            TimeToLiveSpecification = @{ AttributeName = "expires_at"; Enabled = $true }
        } }
        VisionPolicy = @{ Type = "AWS::IAM::Policy"; DependsOn = "QuotaTable"; Properties = @{
            PolicyName = "cloudtutor-vision-secret-quota-and-deferral"; Roles = @($CtRoles)
            PolicyDocument = @{ Version = "2012-10-17"; Statement = $CtStatements }
        } }
    }
    $CtAlarmIndex = 0
    foreach ($CtName in @($CtTest, $CtMain)) {
        foreach ($CtMetric in @("SecretReadErrors", "DailyQuota", "TerminalFailures", "InvalidOutput", "Gemini429")) {
            $CtAlarmIndex++
            $CtResources["Alarm$CtAlarmIndex"] = @{ Type = "AWS::CloudWatch::Alarm"; Properties = @{
                AlarmName = "alarm-cloudtutor-vision-$CtMetric-$CtName"
                Namespace = "CloudTutor/Vision"; MetricName = $CtMetric
                Dimensions = @(
                    @{ Name = "FunctionName"; Value = $CtName }
                    @{ Name = "Model"; Value = [string]$CtConfigs[$CtName].Environment.Variables.GEMINI_MODEL }
                )
                Statistic = "Sum"; Period = 300; EvaluationPeriods = 1; DatapointsToAlarm = 1
                Threshold = $(if ($CtMetric -eq "Gemini429") { 3 } else { 1 })
                ComparisonOperator = "GreaterThanOrEqualToThreshold"; TreatMissingData = "notBreaching"
                AlarmActions = @("arn:aws:sns:ap-southeast-1:251929332061:sns-cloudtutor-alerts")
            } }
        }
    }
    $CtTemplatePath = Join-Path $CtProject "vision-hardening-stack.json"
    Write-CtJson @{ AWSTemplateFormatVersion = "2010-09-09"; Resources = $CtResources } $CtTemplatePath
    aws cloudformation deploy --stack-name "cloudtutor-vision-hardening" --template-file $CtTemplatePath `
        --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset --region ap-southeast-1 --profile new
    if ($LASTEXITCODE -ne 0) { throw "Hardening infrastructure failed; no Lambda code changed." }

    # Collect every local runtime dependency; retain all business handlers.
    $CtCodeDirectory = Join-Path $CtBuild "function"
    node (Join-Path $CtPayload "buildVisionPackage.js") $CtProject $CtCodeDirectory
    if ($LASTEXITCODE -ne 0) { throw "Function packaging failed." }
    $CtCodeZip = Join-Path $CtBuild "vision-hardening-code.zip"
    Compress-Archive -Path (Join-Path $CtCodeDirectory "*") -DestinationPath $CtCodeZip -Force

    Write-Host "`n========== 6. TEST LAMBDA SECRET ACCESS =========="
    Deploy-CtVisionCode $CtTest
    $CtHealth = Invoke-CtVision $CtTest @{ test = "VISION_SECRET_HEALTH_CHECK" } "test-secret-health"
    if ($CtHealth.secret_access -ne $true -or $CtHealth.secret_source -ne "SECRETS_MANAGER") { throw "Secret health check not confirmed." }
    Set-CtVisionConfig $CtTest -RemoveEnvironmentKey
    $CtHealth = Invoke-CtVision $CtTest @{ test = "VISION_SECRET_HEALTH_CHECK" } "test-secret-no-env-key"
    if ($CtHealth.environment_key_present -ne $false) { throw "Test Lambda still contains the environment API key." }

    Write-Host "`n========== 7. ONE REAL FRAME CALL, CACHE AND HANDOFF =========="
    $CtJobId = "vision-hardening-test-" + [guid]::NewGuid().ToString("N")
    $CtVersion = [guid]::NewGuid().ToString("N")
    $CtFrameKey = "frames/test-user/$CtJobId/source_frame.0000000.jpg"
    $CtFixture = @{ job_id = $CtJobId; owner_id = "test-user"; processing_version = $CtVersion
        frame_key = $CtFrameKey; function_name = $CtTest }
    Write-CtJson $CtFixture (Join-Path $CtReport "fixture.json")
    $CtItemPath = Join-Path $CtReport "fixture-item.json"
    Write-CtJson @{
        job_id = @{ S = $CtJobId }; owner_id = @{ S = "test-user" }; processing_version = @{ S = $CtVersion }
        status = @{ S = "PROCESSING_VISION" }; test_fixture = @{ BOOL = $true }; updated_at = @{ S = [DateTime]::UtcNow.ToString("o") }
    } $CtItemPath
    $null = Invoke-CtAws -Arguments @("dynamodb", "put-item", "--table-name", "ddb-cloudtutor-jobs", "--item", "file://$CtItemPath", "--condition-expression", "attribute_not_exists(job_id)")
    $CtSourceFrame = "frames/test-user/vision-content-test-7cb7e5e0457e45dd946d3df2b843209b/source_frame.0000000.jpg"
    aws s3 cp "s3://$CtBucket/$CtSourceFrame" "s3://$CtBucket/$CtFrameKey" --only-show-errors --region ap-southeast-1 --profile new
    if ($LASTEXITCODE -ne 0) { throw "Cannot copy the previously verified content frame. Keep the fixture; do not rerun everything." }
    $CtProbe = Invoke-CtVision $CtTest @{
        test = "VISION_FRAME_CACHE_CHECK"; owner_id = "test-user"; job_id = $CtJobId
        processing_version = $CtVersion; frame_key = $CtFrameKey
    } "frame-cache-check"
    if ($CtProbe.second_cache_hit -ne $true -or $CtProbe.useful -ne $true) { throw "Frame cache/content check not confirmed." }
    $CtBody = @{ schema_version = "1.0"; owner_id = "test-user"; job_id = $CtJobId
        processing_version = $CtVersion; duration_seconds = 5; frame_interval_seconds = 5 }
    $null = Invoke-CtVision $CtTest @{ Records = @(@{
        messageId = "hardening-$CtJobId"; eventSource = "aws:sqs"
        body = (ConvertTo-Json -InputObject $CtBody -Compress)
    }) } "fixture-handoff"
    $CtKeyPath = Join-Path $CtReport "fixture-key.json"
    Write-CtJson @{ job_id = @{ S = $CtJobId } } $CtKeyPath
    $CtAfter = Invoke-CtAws -Arguments @("dynamodb", "get-item", "--table-name", "ddb-cloudtutor-jobs", "--key", "file://$CtKeyPath", "--consistent-read")
    Write-CtJson $CtAfter (Join-Path $CtReport "fixture-after.json")
    if ($CtAfter.Item.status.S -ne "PROCESSING_AI" -or $CtAfter.Item.vision_handoff_state.S -ne "SENT") { throw "Fixture handoff not confirmed." }
    Write-Host "PASS: Secret -> Gemini -> frame cache -> PENDING/SENT handoff to test AI queue."

    Write-Host "`n========== 8. MAIN LAMBDA CUTOVER =========="
    Write-Host "Do not upload new videos until this step finishes."
    foreach ($CtArn in $CtQueueArns | Where-Object { $_ -like "*:sqs-cloudtutor-vision-processing" }) {
        $CtUrl = "https://sqs.ap-southeast-1.amazonaws.com/251929332061/" + ($CtArn -split ":")[-1]
        $CtQueueState = Invoke-CtAws -Arguments @("sqs", "get-queue-attributes", "--queue-url", $CtUrl,
            "--attribute-names", "ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible")
        if ([int]$CtQueueState.Attributes.ApproximateNumberOfMessages -gt 0 -or [int]$CtQueueState.Attributes.ApproximateNumberOfMessagesNotVisible -gt 0) {
            throw "Main Vision queue is busy. Test rollout passed, main cutover not performed; send the output."
        }
    }
    Deploy-CtVisionCode $CtMain
    $CtMainHealth = Invoke-CtVision $CtMain @{ test = "VISION_SECRET_HEALTH_CHECK" } "main-secret-health"
    if ($CtMainHealth.secret_access -ne $true) { throw "Main secret access not confirmed; environment key has not been removed." }
    Set-CtVisionConfig $CtMain -RemoveEnvironmentKey
    $CtMainHealth = Invoke-CtVision $CtMain @{ test = "VISION_SECRET_HEALTH_CHECK" } "main-secret-no-env-key"
    if ($CtMainHealth.environment_key_present -ne $false) { throw "Main Lambda still contains the environment API key." }
    Write-Host "PASS: Main and test Vision read Secrets Manager; raw environment keys removed."

    Write-Host "`n========== 9. DEPLOY DUE-QUOTA RECOVERY =========="
    # No OCR-fixture reset here. Original recovery tests run; schedule is previewed then reenabled.
    powershell -NoProfile -ExecutionPolicy Bypass -File .\deployRealRecovery.ps1
    if ($LASTEXITCODE -ne 0) { throw "Vision rollout passed, recovery redeploy needs review. Send the output; do not rerun the whole hardening script." }

    # Bound the SQS pollers, not direct diagnostic/reconcile invocations.
    foreach ($CtName in @($CtTest, $CtMain)) {
        $CtMappings = Invoke-CtAws -Arguments @("lambda", "list-event-source-mappings", "--function-name", $CtName)
        foreach ($CtMapping in $CtMappings.EventSourceMappings) {
            if ($CtQueueArns -contains $CtMapping.EventSourceArn) {
                if ($CtName -ne $CtMain -or -not (Test-Path .\main-vision-consumer-stack.json)) {
                    $null = Invoke-CtAws -Arguments @("lambda", "update-event-source-mapping", "--uuid", $CtMapping.UUID, "--scaling-config", "MaximumConcurrency=2")
                }
            }
        }
    }
    if (Test-Path .\main-vision-consumer-stack.json) {
        $CtMainStackPath = Join-Path $CtProject "main-vision-consumer-stack.json"
        Copy-Item $CtMainStackPath $CtBackup -Force
        $CtMainStack = Get-Content $CtMainStackPath -Raw | ConvertFrom-Json
        if ($CtMainStack.Resources.VisionConsumer.Properties.FunctionName -ne $CtMain) {
            throw "Unexpected main Vision consumer template; direct quota handling is deployed, review concurrency separately."
        }
        $CtMainStack.Resources.VisionConsumer.Properties | Add-Member -NotePropertyName ScalingConfig -NotePropertyValue @{ MaximumConcurrency = 2 } -Force
        Write-CtJson $CtMainStack $CtMainStackPath
        aws cloudformation deploy --stack-name "cloudtutor-main-vision-consumer" --template-file $CtMainStackPath `
            --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset --region ap-southeast-1 --profile new
        if ($LASTEXITCODE -ne 0) { throw "Main Vision poller concurrency update failed; send the output." }
    }
    Write-CtJson @{ reports = $CtReport; backups = $CtBackup; secret_name = $CtSecretName
        layer_arn = $CtLayerArn; quota_table = $CtTable; fixture = $CtFixture; main_health = $CtMainHealth
    } .\vision-hardening-latest.json
    Write-Host "`nPASS: VISION HARDENING COMPLETE."
    Write-Host "Reports:" $CtReport
    Write-Host "Backups:" $CtBackup
    Write-Host "AI queue destinations were not changed."
    Write-Host "Daily quota/429 behaviors were simulated locally; real frame call and Secrets Manager were tested on AWS."
    Write-Host "New next_retry_at and lease fields must be retained by Member 1 during ordinary updates."
}
