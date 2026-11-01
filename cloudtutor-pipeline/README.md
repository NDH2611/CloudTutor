# CloudTutor Processing Pipeline — Member 2

## Phạm vi

S3/SQS → Worker → Transcribe → Completion.
ASR hoàn tất nhưng rỗng → MediaConvert/Rekognition OCR.
OCR rỗng sau lọc → SQS Vision → Gemini.
Nguồn hợp lệ lưu S3, tạo checkpoint rồi bàn giao SQS AI.

- Region: ap-southeast-1.
- Video: videos/{owner_id}/{job_id}/source.mp4.
- Giới hạn: 500.000.000 byte; kiểm tra kích thước và header MP4,
  không thay thế giải mã/kiểm tra codec toàn bộ video.
- Results dùng content_source, transcript_key, processing_version.
- Message dùng source và handoff_id; processing_version là string.

## Kiểm thử local

Chạy trong cloudtutor-pipeline với Node.js tương thích mã nguồn Node22:

    npm test

Năm suite dùng AWS/Gemini giả lập, không deploy hoặc tạo job dịch vụ thật.
PASS local không thay thế nghiệm thu AWS/toàn hệ thống.

## Runtime dependencies và secret

Lambda dùng code-only ZIP và dependency Layer.
Worker/Completion/OCR: cloudtutor-node22-dependencies:1.
Vision: cloudtutor-node22-dependencies:2, có Secrets Manager SDK.
Đối chiếu lại cấu hình AWS khi chốt release.

Vision đọc secret cloudtutor/dev/gemini-api-key; không đưa key vào
source/Git/log/frontend. Layer Lambda không tự cài dependency local.
Giữ package-lock.json để tái lập dependency khi cần.

## Triển khai và rollback

Không chạy lại script deploy/test AWS chỉ để kiểm tra source.
Đọc README trong m2-vision-hardening và m2-input-ocr trước khi chạy.
Các script có tạo fixture không phải lệnh deploy chạy tùy ý.

Chốt release bằng source hash, ZIP inventory, handler, runtime và Layer.
Giữ backup trước thay đổi; rollback phải xét code, Layer và configuration.
ZIP/manifest cũ không tự cập nhật theo source mới.

## Giới hạn bàn giao

- SENT nghĩa đã gửi SQS, không phải AI đã hoàn tất.
- Consumer AI phải chống trùng theo handoff_id.
- Retry phiên mới/xóa khi chạy cần contract và kiểm thử chung.
- Vision là mô tả ảnh AI; timestamp OCR/Vision là lấy mẫu.
- OCR tiếng Việt có thể sai dấu; giữ warnings.
- Benchmark hiện có đo Worker/ASR đến handoff, chưa phải toàn hệ thống.
- Xác nhận AI queue destination trước khi tích hợp Vision với M3.

## Bằng chứng

reports/benchmarks/, reports/recovery-tests/, reports/vision-hardening/,
reports/input-ocr/, reports/monitoring-verification/ và reports/releases/.

Ghi rõ test giả lập, test AWS thật và phiên bản được kiểm thử.
Không commit node_modules, ZIP cũ hoặc backup riêng.