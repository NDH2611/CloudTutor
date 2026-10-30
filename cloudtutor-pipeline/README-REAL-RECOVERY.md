# CloudTutor: bounded real-job recovery

Extract these five files into `C:\CloudTutor\cloudtutor-pipeline`, alongside `onFramesReady.js`.

Run in PowerShell:

```powershell
cd C:\CloudTutor\cloudtutor-pipeline
powershell -NoProfile -ExecutionPolicy Bypass -File .\deployRealRecovery.ps1 -RunOcrFixtureTest
```

The process runs local rule tests; builds a separate Lambda SDK client without changing the project's dependencies or existing Layer; deploys a new recovery Lambda with its schedule disabled; previews real jobs without mutation; simulates a missing MediaConvert COMPLETE event using the existing black-video **test fixture only**; and enables the schedule after the test succeeds. It does not change any existing function's AI queue.

The test invokes OCR and Vision and incurs their service charges for one short existing test video. It does not start a new Transcribe or MediaConvert job. It temporarily changes the existing black-video fixture from FAILED to PROCESSING_OCR, preserving its owner/version/service ID; on success the ordinary pipeline returns it to FAILED/VISION_NO_USEFUL_SAMPLED_FRAMES. The prior item and output are saved under reports/recovery-tests/. If a test fails, stop and retain those files; the schedule remains disabled. Do not rerun the complete script blindly.

## Production scope

- Every 15 minutes, inspect nonfixture jobs that have been stale for at least 30 minutes.
- At most one recovery invocation per run; scan up to 2,000 items, report truncation.
- ASR terminal COMPLETED/FAILED: verify service name and media URI, then invoke the existing main Completion handler.
- OCR terminal COMPLETE/ERROR: verify the stored MediaConvert ID, owner, job, version, input and metadata. COMPLETE uses the service's derived-MP4 output duration and the single existing derived MP4 path, then invokes the existing main OCR handler. Never infer duration from sampled frames.
- PENDING AI handoff: validate Results source/version/key, then invoke the corresponding main handler. Vision receives a recovery SQS-shaped event and uses its existing checkpoint recovery path before frame analysis.
- SENT checkpoints are not resent. DELETING/DELETED, completed/failed jobs and ordinary test fixtures are excluded.
- A conditional lease prevents overlapping reconcilers; attempts are limited to three per processing version, at least 15 minutes apart.
- Missing IDs, missing output duration, canceled jobs, unknown service records or mismatched metadata are reported as REVIEW. No Transcribe/MediaConvert jobs are automatically recreated. PROCESSING_VISION without a PENDING checkpoint remains under the Vision queue's retries/DLQ and manual review.

## Guarantees and limits

The lease does not coordinate with ordinary handlers. Lambda/SQS delivery is at least once, and sending a message and setting SENT are not atomic. Member 3 must continue deduplicating by handoff_id. A successful handler invocation is not equivalent to completed study-content generation; the report includes the observed job state after invocation.

The production handlers retain their existing queue settings. At the time this package was prepared, ASR/OCR used the shared AI queue and Vision used the test handoff queue. This package does not unify those destinations or enable Member 3's Gemini worker.

The original read-only monitor/test-only recovery remains available. The new schedule handles real jobs; ordinary test fixtures are excluded, avoiding overlap with the existing test-only reconciler.

## Evidence and commit

Local tests validate guards and event reconstruction. The real OCR-fixture replay validates MediaConvert GetJob/output metadata, invocation IAM and the main OCR/Vision handlers. A production dry run may contain no eligible jobs; this is not evidence that production job recovery has already occurred. A scheduled invocation must be observed separately if the report claims it was tested.

After all steps pass:

```powershell
git add -- recoveryRules.js reconcileRealJobs.js testRecoveryRules.js deployRealRecovery.ps1 README-REAL-RECOVERY.md real-recovery-stack.json real-recovery-build-package.json real-recovery-build-package-lock.json reports/recovery-tests
git diff --cached --check
git diff --cached --stat
git commit -m "feat(pipeline): recover stale real job handoffs and terminal service events"
git push
```

Do not add local-real-recovery-build/node_modules to Git.

Emergency pause:

```powershell
aws lambda put-function-concurrency --function-name lambda-cloudtutor-reconcile-real-jobs --reserved-concurrent-executions 0 --region ap-southeast-1 --profile new
```

Pausing the Lambda does not retract an already submitted target-handler invocation. To resume, remove that concurrency override and use the CloudFormation template as the authoritative schedule configuration.
