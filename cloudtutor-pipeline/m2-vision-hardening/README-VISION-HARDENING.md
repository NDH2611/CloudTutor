# CloudTutor: Secrets Manager, Vision metrics and quota recovery

## Install and run

Extract the ZIP into `C:\CloudTutor\cloudtutor-pipeline`. It creates a subfolder named `m2-vision-hardening` and initially overwrites no existing pipeline source files.

```powershell
cd C:\CloudTutor\cloudtutor-pipeline
powershell -NoProfile -ExecutionPolicy Bypass -File .\m2-vision-hardening\deployVisionHardening.ps1
```

Do not upload new videos during the rollout. The script refuses a busy main Vision queue before main cutover. If any stage fails, stop and send its output; do not rerun the entire script blindly because it can publish another Layer version or create another test fixture. The main Lambda is changed only after the test Lambda's secret access and real frame/cache/handoff check pass.

## Actions

1. Verify the AWS account, Node22/x86_64/300s runtimes, expected test AI destinations, non-VPC configuration and batch-size-one mappings. Back up deployed function ZIPs and affected source files under local-vision-hardening-backups. Backup metadata does not include API-key values.
2. Patch the exact reviewed handler and real-recovery source, run 35 Vision checks, 24 recovery regression checks and 6 due-quota recovery checks. Changes to unfamiliar source anchors stop the script before AWS configuration changes.
3. Create `cloudtutor/dev/gemini-api-key` from the existing main Vision environment key if absent, using the JSON schema `{"api_key":"..."}`. Never print the key; use a temporary request file deleted immediately. An existing secret is not overwritten. Readers also accept a plain key string or the JSON field `GEMINI_API_KEY` for compatibility.
4. Publish a new immutable Node22 dependency Layer containing the original six pinned SDKs plus Secrets Manager. The existing Layer version and other Lambdas remain unchanged. Build files live under local-vision-hardening-build; runtime lock files are copied under infra/vision-runtime-layer. Native binaries in the dependency tree abort the Windows-layer build.
5. Create a small on-demand DynamoDB cooldown table, least-scoped additional IAM permissions and CloudWatch EMF alarms for SecretReadErrors, DailyQuota, TerminalFailures, InvalidOutput and bursts of Gemini429. CloudWatch/SNS, Secrets Manager, DynamoDB and the real frame request can incur charges.
6. Deploy the test Vision function, confirm GetSecretValue works, remove GEMINI_API_KEY from that function and confirm secret access again without it.
7. Create one new test fixture from the previously verified content frame. The diagnostic makes one real frame request, then confirms an S3 frame-cache hit. The normal handler reuses that frame cache and hands off to the test AI queue. No frame descriptions or key values are returned by diagnostics. Usage counts and health flags are retained in reports/vision-hardening.
8. Deploy the same code and new Layer to main Vision, verify Secrets Manager access, then remove its raw environment key and verify again. Other environment variables, AI queue destinations and handler names are preserved.
9. Redeploy the real-job reconciler to resume due Vision quota checkpoints, and cap each Vision SQS consumer at two concurrent poller invocations. The poller cap is not a global quota guarantee and does not limit direct invokes or Member 3's services.

## Runtime behavior

- Read `AWSCURRENT` using Secrets Manager, cache for five minutes and coalesce concurrent reads. There is no environment-key fallback. Read errors are sanitized.
- Emit EMF metrics in `CloudTutor/Vision` with only FunctionName and Model dimensions. Do not dimension metrics by job/frame/user ID. `GeminiLatencyMs` measures HTTP attempt latency until response headers; it is not total pipeline latency. Request counts reflect HTTP attempts, not unique videos. Token totals reflect provider usage returned on actual requests and exclude frame-cache hits. Invalid/missing provider usage cannot provide complete billing totals.
- Retry transient network/timeout/408/429/500/502/503/504 errors at most three times per frame request, bounded by a 70-second budget. Use exponential backoff/jitter and parse Retry-After/Google RetryInfo. A long wait is deferred instead of holding the Lambda open.
- Classify daily quota only when structured QuotaFailure identifiers explicitly indicate daily/per-day limits. Unknown 429 is not guessed to be daily quota. Explicit daily quota pauses checks for at least six hours, or longer when requested. This is a conservative recheck interval, not a claim about Google's quota reset time.
- A durable cooldown keyed by secret identifier and model applies to these two Vision Lambdas only. AI/Q&A do not automatically share this policy; Member 3 must coordinate separately.
- Jobs use `vision_retry_state`, `vision_retry_version`, `vision_retry_attempts`, `vision_retry_reason`, numeric epoch-seconds `next_retry_at`, and `vision_lease_until`/`vision_lease_token`. Retain these fields during ordinary Member 1 updates. Version changes receive a fresh API-attempt budget.
- Defer SQS visibility, keep the job at PROCESSING_VISION and throw so the mapping does not acknowledge a waiting message. Visibility is capped at 12 hours per SQS call; the persisted due date is not shortened. Existing redrive limits remain active.
- After three failed API-processing rounds per version, mark FAILED/VISION_GEMINI_RETRIES_EXHAUSTED. Permanent HTTP errors mark FAILED/VISION_GEMINI_HTTP_<status>. These are business failures and raise the custom TerminalFailures metric even though the handler acknowledges the message.
- A conditional Vision lease prevents concurrent normal/reconcile execution for the same Vision job/version. It does not make SQS delivery or handoff exactly-once and does not introduce stage leases for ASR/OCR. Member 3 still deduplicates handoff_id.
- Save useful and non-useful per-frame results under results/<owner>/<job>/vision-frames-v<version>/, keyed by image/frame/model/prompt hash. Retry reuses completed frame results. Full-output and handoff recovery remain intact.
- The real-job reconciler only resumes PROCESSING_VISION when vision_retry_state is WAITING, the retry version matches, and next_retry_at is due. It still applies the normal 30-minute staleness floor and reads actual duration/interval from the matching normalized OCR file. It does not requeue arbitrary active Vision jobs, recreate missing service tasks, or replay DLQ entries.

## Verification boundaries

Local tests simulate quota errors, IAM-independent secret caching, retry bounds, lease guards, deleted/stale messages, cache semantics and SQS deferral. They make no real AWS/Gemini requests. The script's AWS checks prove actual Secrets Manager access, one successful Gemini request, S3 frame caching and test-queue handoff. They do not deliberately exhaust a Google quota, prove real quota reset timing, or prove Member 3 integration. View newly extracted EMF metrics/alarms separately; propagation and SNS delivery are not instantaneous.

Diagnostics only run on explicitly tagged invocation events. The frame probe additionally requires an exact owner/version match on a PROCESSING_VISION test_fixture job. Ordinary SQS messages follow the standard pipeline.

## Commit after the rollout passes

```powershell
git add -- m2-vision-hardening geminiSecret.js geminiRetry.js geminiVision.js visionMetrics.js visionErrors.js visionQuota.js visionFrameCache.js visionRuntime.js visionDiagnostics.js onVisionFallback.js testGeminiRetry.js testVisionHardening.js testVisionQuotaRecovery.js recoveryRules.js reconcileRealJobs.js deployRealRecovery.ps1 vision-hardening-stack.json infra/vision-runtime-layer real-recovery-stack.json main-vision-consumer-stack.json reports/vision-hardening
git diff --cached --check
git diff --cached --stat
git commit -m "feat(vision): use Secrets Manager and persist observable quota recovery"
git push
```

Do not add local-vision-hardening-build/node_modules or temporary private request files to Git. There is no need to rerun the 36-job ASR benchmark; its relevant code has not changed.

## If rollout stops

Do not print GetSecretValue responses or full Lambda environment configuration into chat. Send the failed stage and sanitized response/log files. Deployed ZIP backups and source snapshots are under the printed backup directory. If test-stage quota is reached, keep the new fixture and cooldown records rather than creating more fixtures. If main cutover passed but recovery redeploy failed, keep the working Vision deployment and fix/redeploy recovery separately.

Preexisting full Vision cache files are retained and may lack new provenance fields. New outputs include model/prompt_version and no longer carry the old VISION_CACHE_TEST marker. No existing source files, queue messages or user outputs are deleted by this package.
