param([switch]$RunOcrFixtureTest)

& {
    $ErrorActionPreference = "Stop"
    Set-Location $PSScriptRoot
    if (-not (Test-Path ".\onFramesReady.js")) {
        throw "Extract these files into cloudtutor-pipeline before running."
    }

    $env:AWS_CLI_FILE_ENCODING = "UTF-8"
    $env:PYTHONUTF8 = "1"
    $env:PYTHONIOENCODING = "utf-8"
    $CtUtf8 = New-Object System.Text.UTF8Encoding($false)
    $CtFunctionName = "lambda-cloudtutor-reconcile-real-jobs"
    $CtBucket = "s3-cloudtutor-media-251929332061"

    function Invoke-CtAws {
        param([string[]]$Arguments)
        $CtOutput = & aws @Arguments --region ap-southeast-1 --profile new --output json --no-cli-pager
        if ($LASTEXITCODE -ne 0) { throw "AWS failed: $($Arguments[0]) $($Arguments[1])" }
        if ($CtOutput) { return ($CtOutput | ConvertFrom-Json) }
    }
    function Write-CtJson {
        param($Value, [string]$Path)
        $Path = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
        [System.IO.File]::WriteAllText($Path,
            (ConvertTo-Json -InputObject $Value -Depth 60 -Compress), $CtUtf8)
    }
    function Deploy-CtStack {
        param([string]$Template)
        aws cloudformation deploy --stack-name "cloudtutor-real-job-recovery" `
            --template-file $Template --capabilities CAPABILITY_IAM `
            --no-fail-on-empty-changeset --region ap-southeast-1 --profile new
        if ($LASTEXITCODE -ne 0) { throw "Recovery stack deployment failed." }
    }
    function Invoke-CtRecovery {
        param($Event, [string]$Label)
        $CtEventFile = Join-Path $CtReportDir "$Label-event.json"
        $CtResponseFile = Join-Path $CtReportDir "$Label-response.json"
        Write-CtJson $Event $CtEventFile
        $CtInvoke = Invoke-CtAws -Arguments @(
            "lambda", "invoke", "--function-name", $CtFunctionName,
            "--cli-binary-format", "raw-in-base64-out", "--payload", "file://$CtEventFile",
            "--cli-read-timeout", "440", "--log-type", "Tail", $CtResponseFile
        )
        if ($CtInvoke.LogResult) {
            [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($CtInvoke.LogResult)) |
                Write-Host
        }
        $CtResponseText = Get-Content $CtResponseFile -Raw -Encoding UTF8
        Write-Host $CtResponseText
        if ($CtInvoke.FunctionError) { throw "Recovery Lambda failed; keep the response and do not recreate the fixture." }
        return ($CtResponseText | ConvertFrom-Json)
    }

    $CtAccount = Invoke-CtAws -Arguments @("sts", "get-caller-identity")
    if ($CtAccount.Account -ne "251929332061") { throw "Wrong AWS account." }

    Write-Host "`n========== 1. LOCAL RULE TESTS =========="
    foreach ($CtFile in @("recoveryRules.js", "reconcileRealJobs.js", "testRecoveryRules.js")) {
        node --check ".\$CtFile"
        if ($LASTEXITCODE -ne 0) { throw "Syntax error: $CtFile" }
    }
    node .\testRecoveryRules.js
    if ($LASTEXITCODE -ne 0) { throw "Rule tests failed. Nothing deployed." }

    $CtRunId = Get-Date -Format "yyyyMMdd-HHmmss"
    $CtReportDir = Join-Path $PWD "reports\recovery-tests\$CtRunId"
    New-Item -ItemType Directory -Path $CtReportDir -Force | Out-Null
    $CtBuild = Join-Path $PWD "local-real-recovery-build"
    New-Item -ItemType Directory -Path $CtBuild -Force | Out-Null

    Write-Host "`n========== 2. BUILD ISOLATED INVOKE CLIENT =========="
    # Dependencies stay in this build folder; the project package.json and Layer do not change.
    if (-not (Test-Path (Join-Path $CtBuild "package-lock.json"))) {
        Write-CtJson @{ name = "cloudtutor-real-recovery-build"; version = "1.0.0"; private = $true } `
            (Join-Path $CtBuild "package.json")
        $CtLambdaVersion = (& npm view "@aws-sdk/client-lambda" version | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or $CtLambdaVersion -notmatch '^\d+\.\d+\.\d+$') { throw "Cannot resolve Lambda SDK version." }
        $CtEsbuildVersion = (& npm view esbuild version | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or $CtEsbuildVersion -notmatch '^\d+\.\d+\.\d+$') { throw "Cannot resolve esbuild version." }
        & npm install --prefix $CtBuild --save-exact "@aws-sdk/client-lambda@$CtLambdaVersion" "esbuild@$CtEsbuildVersion"
        if ($LASTEXITCODE -ne 0) { throw "Build dependency install failed." }
    } else {
        & npm ci --prefix $CtBuild
        if ($LASTEXITCODE -ne 0) { throw "Build dependency restore failed." }
    }
    Copy-Item .\reconcileRealJobs.js, .\recoveryRules.js $CtBuild -Force
    $CtEsbuild = Join-Path $CtBuild "node_modules\esbuild\bin\esbuild"
    $CtIndex = Join-Path $CtBuild "index.js"
    $CtBuildArgs = @(
        $CtEsbuild, (Join-Path $CtBuild "reconcileRealJobs.js"),
        "--bundle", "--platform=node", "--target=node22", "--format=cjs", "--minify",
        "--outfile=$CtIndex",
        "--external:@aws-sdk/client-dynamodb", "--external:@aws-sdk/client-transcribe",
        "--external:@aws-sdk/client-mediaconvert", "--external:@aws-sdk/client-s3"
    )
    & node @CtBuildArgs
    if ($LASTEXITCODE -ne 0) { throw "Bundle failed." }
    node --check $CtIndex
    if ($LASTEXITCODE -ne 0) { throw "Bundle syntax error." }
    $CtZip = Join-Path $CtBuild "real-recovery.zip"
    Compress-Archive -Path $CtIndex -DestinationPath $CtZip -Force
    $CtSha = (Get-FileHash $CtZip -Algorithm SHA256).Hash.ToLowerInvariant()
    $CtCodeKey = "deployment-artifacts/real-recovery/$CtSha.zip"
    aws s3 cp $CtZip "s3://$CtBucket/$CtCodeKey" --only-show-errors --region ap-southeast-1 --profile new
    if ($LASTEXITCODE -ne 0) { throw "Code upload failed." }

    $CtFailureStack = Invoke-CtAws -Arguments @("cloudformation", "describe-stacks", "--stack-name", "cloudtutor-m2-failure-monitoring")
    $CtFailureUrl = ($CtFailureStack.Stacks[0].Outputs | Where-Object { $_.OutputKey -eq "AsyncFailureQueueUrl" }).OutputValue
    if (-not $CtFailureUrl) { throw "Missing failure destination." }
    $CtAttrs = Invoke-CtAws -Arguments @("sqs", "get-queue-attributes", "--queue-url", $CtFailureUrl, "--attribute-names", "QueueArn")
    $CtFailureArn = $CtAttrs.Attributes.QueueArn
    $CtFunctionArn = "arn:aws:lambda:ap-southeast-1:251929332061:function:$CtFunctionName"

    # Keep a pinned build lock alongside the deployable sources.
    Copy-Item (Join-Path $CtBuild "package.json") .\real-recovery-build-package.json -Force
    Copy-Item (Join-Path $CtBuild "package-lock.json") .\real-recovery-build-package-lock.json -Force

    $CtTemplate = @{
        AWSTemplateFormatVersion = "2010-09-09"
        Description = "CloudTutor bounded real job recovery without resending SENT checkpoints"
        Resources = @{
            Logs = @{
                Type = "AWS::Logs::LogGroup"
                Properties = @{ LogGroupName = "/aws/lambda/$CtFunctionName"; RetentionInDays = 14 }
            }
            RecoveryRole = @{
                Type = "AWS::IAM::Role"
                Properties = @{
                    AssumeRolePolicyDocument = @{
                        Version = "2012-10-17"
                        Statement = @(@{ Effect = "Allow"; Principal = @{ Service = "lambda.amazonaws.com" }; Action = "sts:AssumeRole" })
                    }
                    Policies = @(@{
                        PolicyName = "BoundedRecovery"
                        PolicyDocument = @{
                            Version = "2012-10-17"
                            Statement = @(
                                @{ Effect = "Allow"; Action = @("dynamodb:Scan", "dynamodb:GetItem", "dynamodb:UpdateItem"); Resource = "arn:aws:dynamodb:ap-southeast-1:251929332061:table/ddb-cloudtutor-jobs" }
                                @{ Effect = "Allow"; Action = "dynamodb:GetItem"; Resource = "arn:aws:dynamodb:ap-southeast-1:251929332061:table/ddb-cloudtutor-results" }
                                @{ Effect = "Allow"; Action = "transcribe:GetTranscriptionJob"; Resource = "arn:aws:transcribe:ap-southeast-1:251929332061:transcription-job/transcribe-cloudtutor-*" }
                                @{ Effect = "Allow"; Action = "mediaconvert:GetJob"; Resource = "arn:aws:mediaconvert:ap-southeast-1:251929332061:jobs/*" }
                                @{ Effect = "Allow"; Action = "s3:ListBucket"; Resource = "arn:aws:s3:::$CtBucket"; Condition = @{ StringLike = @{ "s3:prefix" = "derived/*" } } }
                                @{ Effect = "Allow"; Action = "lambda:InvokeFunction"; Resource = @(
                                    "arn:aws:lambda:ap-southeast-1:251929332061:function:lambda-cloudtutor-transcription-completed"
                                    "arn:aws:lambda:ap-southeast-1:251929332061:function:lambda-cloudtutor-process-frames"
                                    "arn:aws:lambda:ap-southeast-1:251929332061:function:lambda-cloudtutor-vision-fallback"
                                ) }
                                @{ Effect = "Allow"; Action = "sqs:SendMessage"; Resource = $CtFailureArn }
                                @{ Effect = "Allow"; Action = @("logs:CreateLogStream", "logs:PutLogEvents"); Resource = "arn:aws:logs:ap-southeast-1:251929332061:log-group:/aws/lambda/${CtFunctionName}:*" }
                            )
                        }
                    })
                }
            }
            RecoveryFunction = @{
                Type = "AWS::Lambda::Function"
                DependsOn = "Logs"
                Properties = @{
                    FunctionName = $CtFunctionName; Runtime = "nodejs22.x"; Handler = "index.handler"
                    Architectures = @("x86_64"); Timeout = 420; MemorySize = 256
                    Role = @{ "Fn::GetAtt" = @("RecoveryRole", "Arn") }
                    Code = @{ S3Bucket = $CtBucket; S3Key = $CtCodeKey }
                    Layers = @("arn:aws:lambda:ap-southeast-1:251929332061:layer:cloudtutor-node22-dependencies:1")
                    Environment = @{ Variables = @{ ENABLE_REAL_RECOVERY = "true" } }
                }
            }
            AsyncErrors = @{
                Type = "AWS::Lambda::EventInvokeConfig"
                Properties = @{
                    FunctionName = @{ Ref = "RecoveryFunction" }; Qualifier = '$LATEST'
                    MaximumRetryAttempts = 2; MaximumEventAgeInSeconds = 3600
                    DestinationConfig = @{ OnFailure = @{ Destination = $CtFailureArn } }
                }
            }
            ScheduleRole = @{
                Type = "AWS::IAM::Role"
                Properties = @{
                    AssumeRolePolicyDocument = @{
                        Version = "2012-10-17"
                        Statement = @(@{
                            Effect = "Allow"; Principal = @{ Service = "scheduler.amazonaws.com" }; Action = "sts:AssumeRole"
                            Condition = @{ StringEquals = @{ "aws:SourceAccount" = "251929332061" } }
                        })
                    }
                    Policies = @(@{
                        PolicyName = "InvokeRecoveryAndRetainDeliveryErrors"
                        PolicyDocument = @{
                            Version = "2012-10-17"
                            Statement = @(
                                @{ Effect = "Allow"; Action = "lambda:InvokeFunction"; Resource = @{ "Fn::GetAtt" = @("RecoveryFunction", "Arn") } }
                                @{ Effect = "Allow"; Action = "sqs:SendMessage"; Resource = $CtFailureArn }
                            )
                        }
                    })
                }
            }
            Schedule = @{
                Type = "AWS::Scheduler::Schedule"
                Properties = @{
                    Name = "schedule-cloudtutor-real-job-recovery"
                    State = "DISABLED"
                    ScheduleExpression = "rate(15 minutes)"
                    FlexibleTimeWindow = @{ Mode = "OFF" }
                    Target = @{
                        Arn = @{ "Fn::GetAtt" = @("RecoveryFunction", "Arn") }
                        RoleArn = @{ "Fn::GetAtt" = @("ScheduleRole", "Arn") }
                        Input = '{"mode":"APPLY"}'
                        RetryPolicy = @{ MaximumEventAgeInSeconds = 900; MaximumRetryAttempts = 2 }
                        DeadLetterConfig = @{ Arn = $CtFailureArn }
                    }
                }
            }
            ErrorsAlarm = @{
                Type = "AWS::CloudWatch::Alarm"
                Properties = @{
                    AlarmName = "alarm-cloudtutor-real-job-recovery-errors"
                    Namespace = "AWS/Lambda"; MetricName = "Errors"
                    Dimensions = @(@{ Name = "FunctionName"; Value = @{ Ref = "RecoveryFunction" } })
                    Statistic = "Sum"; Period = 60; EvaluationPeriods = 1; DatapointsToAlarm = 1
                    Threshold = 1; ComparisonOperator = "GreaterThanOrEqualToThreshold"; TreatMissingData = "notBreaching"
                    AlarmActions = @("arn:aws:sns:ap-southeast-1:251929332061:sns-cloudtutor-alerts")
                }
            }
        }
    }
    $CtTemplatePath = Join-Path $PWD "real-recovery-stack.json"
    Write-CtJson $CtTemplate $CtTemplatePath
    Write-Host "`n========== 3. DEPLOY WITH SCHEDULE DISABLED =========="
    Deploy-CtStack $CtTemplatePath

    Write-Host "`n========== 4. PREVIEW REAL JOBS (NO WRITES) =========="
    $CtPreview = Invoke-CtRecovery @{ mode = "DRY_RUN" } "real-jobs-preview"
    if (@($CtPreview.jobs | Where-Object { $_.reason -in @("AccessDeniedException", "AccessDenied", "UnauthorizedException") }).Count -gt 0) {
        throw "Preview found an IAM denial. Schedule remains disabled; send the report."
    }

    if ($RunOcrFixtureTest) {
        Write-Host "`n========== 5. REPLAY LOST OCR EVENT ON EXISTING TEST FIXTURE =========="
        $CtFixture = Get-Content .\main-upload-test-fixture.json -Raw -Encoding UTF8 | ConvertFrom-Json
        $CtKeyPath = Join-Path $CtReportDir "fixture-key.json"
        Write-CtJson @{ job_id = @{ S = $CtFixture.job_id } } $CtKeyPath
        $CtBefore = Invoke-CtAws -Arguments @("dynamodb", "get-item", "--table-name", "ddb-cloudtutor-jobs", "--key", "file://$CtKeyPath", "--consistent-read")
        if ($CtBefore.Item.test_fixture.BOOL -ne $true -or
            $CtBefore.Item.status.S -ne "FAILED" -or
            $CtBefore.Item.error_code.S -ne "VISION_NO_USEFUL_SAMPLED_FRAMES" -or
            -not $CtBefore.Item.ocr_mediaconvert_job_id.S) {
            throw "Fixture is not the completed black-video test. No fixture modified; schedule remains disabled."
        }
        Write-CtJson $CtBefore (Join-Path $CtReportDir "fixture-before.json")
        $CtReset = @{
            TableName = "ddb-cloudtutor-jobs"
            Key = @{ job_id = @{ S = $CtFixture.job_id } }
            ConditionExpression = "test_fixture = :yes AND #s = :failed AND error_code = :error AND #v = :version AND ocr_mediaconvert_job_id = :media"
            UpdateExpression = "SET #s = :ocr, updated_at = :now REMOVE error_code, error_message"
            ExpressionAttributeNames = @{ "#s" = "status"; "#v" = "processing_version" }
            ExpressionAttributeValues = @{
                ":yes" = @{ BOOL = $true }; ":failed" = @{ S = "FAILED" }; ":error" = @{ S = "VISION_NO_USEFUL_SAMPLED_FRAMES" }
                ":version" = @{ S = $CtBefore.Item.processing_version.S }; ":media" = @{ S = $CtBefore.Item.ocr_mediaconvert_job_id.S }
                ":ocr" = @{ S = "PROCESSING_OCR" }; ":now" = @{ S = [DateTime]::UtcNow.ToString("o") }
            }
        }
        $CtResetPath = Join-Path $CtReportDir "fixture-simulate-lost-event.json"
        Write-CtJson $CtReset $CtResetPath
        $null = Invoke-CtAws -Arguments @("dynamodb", "update-item", "--cli-input-json", "file://$CtResetPath")
        Write-Host "Only the designated test_fixture was moved back to PROCESSING_OCR."
        $CtReplay = Invoke-CtRecovery @{ mode = "APPLY"; test_job_id = $CtFixture.job_id } "ocr-fixture-recovery"
        $CtConfirmed = @($CtReplay.jobs | Where-Object { $_.job_id -eq $CtFixture.job_id -and $_.action -eq "INVOKED_REPLAY_OCR_TERMINAL" })
        if ($CtConfirmed.Count -ne 1) {
            throw "OCR replay not confirmed. Schedule remains disabled. Send ocr-fixture-recovery-response.json; do not rerun this script."
        }
        $CtFinished = $false
        for ($CtRound = 1; $CtRound -le 24; $CtRound++) {
            $CtAfter = Invoke-CtAws -Arguments @("dynamodb", "get-item", "--table-name", "ddb-cloudtutor-jobs", "--key", "file://$CtKeyPath", "--consistent-read")
            Write-Host "Fixture status:" $CtAfter.Item.status.S "error:" $CtAfter.Item.error_code.S
            if ($CtAfter.Item.status.S -eq "FAILED") {
                if ($CtAfter.Item.error_code.S -ne "VISION_NO_USEFUL_SAMPLED_FRAMES") { throw "Fixture failed with an unexpected error. Schedule remains disabled." }
                $CtFinished = $true
                break
            }
            Start-Sleep -Seconds 5
        }
        Write-CtJson $CtAfter (Join-Path $CtReportDir "fixture-after.json")
        if (-not $CtFinished) { throw "Fixture did not finish. Schedule remains disabled. Do not rerun the whole script." }
        Write-Host "PASS: Lost OCR COMPLETE event recovered using actual MediaConvert output metadata."
    }

    Write-Host "`n========== 6. ENABLE REAL JOB RECOVERY =========="
    $CtTemplate.Resources.Schedule.Properties.State = "ENABLED"
    Write-CtJson $CtTemplate $CtTemplatePath
    Deploy-CtStack $CtTemplatePath
    $CtSchedule = Invoke-CtAws -Arguments @("scheduler", "get-schedule", "--name", "schedule-cloudtutor-real-job-recovery", "--query", "{Name:Name,State:State,Rate:ScheduleExpression,Target:Target.Arn}")
    $CtSchedule | Format-List
    if ($CtSchedule.State -ne "ENABLED") { throw "Schedule not enabled." }
    Write-CtJson @{ run_id = $CtRunId; report_directory = $CtReportDir; stack = "cloudtutor-real-job-recovery"; function_name = $CtFunctionName; code_s3_key = $CtCodeKey } .\real-recovery-latest.json
    Write-Host "PASS: Real-job recovery is enabled every 15 minutes."
    Write-Host "Scope: stale ASR/OCR terminal events and PENDING handoffs; never resend SENT."
    Write-Host "Evidence:" $CtReportDir
    Write-Host "Missing IDs/metadata, active services and exhausted retries require review; no service jobs are recreated."
}
