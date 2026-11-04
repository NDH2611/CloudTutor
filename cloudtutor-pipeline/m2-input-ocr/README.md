# M2: kiểm tra video đầu vào và đánh giá OCR

## Chạy

Giải nén ZIP vào `C:\CloudTutor\cloudtutor-pipeline`, tạo thư mục `m2-input-ocr`.
Tạm ngừng upload video và không chạy các test E2E khác trong lúc triển khai.

```powershell
cd C:\CloudTutor\cloudtutor-pipeline
powershell -NoProfile -ExecutionPolicy Bypass -File .\m2-input-ocr\deployInputOcr.ps1
```

Nếu lỗi, gửi đúng bước và output. Không chạy lại toàn bộ script vì sẽ tạo thêm fixture và backup.
Nếu chỉ bước OCR cuối thất bại, các Lambda đã triển khai vẫn được giữ. Tiếp tục bài đo với thư mục báo cáo đã in:

```powershell
$env:AWS_PROFILE = "new"
$env:AWS_REGION = "ap-southeast-1"
node .\ocrEvaluation.js "<duong-dan-report>\ocr-language"
```

Phản hồi đã có được lưu và tái sử dụng, tránh gọi lại toàn bộ bài đo.

## Script làm gì

1. Đối chiếu account/bucket/runtime/Layer, sao lưu code đang deploy của Worker chính, OCR chính và Worker thử. Không lưu nguyên environment vào báo cáo. Chặn nếu Worker thử có consumer đang hoạt động hoặc S3 notification có thể nhận prefix thử.
2. Chỉ patch đúng hai source đã review theo SHA-256. Chạy 26 test module và 8 test handler với AWS giả lập. Đóng ZIP theo dependency local, không chứa node_modules, không thay Layer hiện có.
3. Tạo stack `cloudtutor-input-validation` bổ sung quyền `s3:GetObject` cho role Worker ở prefix videos và prefix thử. Đọc HEAD và tối đa 64 KiB đầu của video MP4 fixture thật có sẵn; không gọi Transcribe.
4. Tạm triển khai Worker thử để nhận prefix `m2-input-tests/`, nằm ngoài notification `videos/`. Tạo hai job test_fixture, một file rỗng và một file text đổi đuôi mp4. Invoke Worker trực tiếp và xác nhận FAILED đúng mã lỗi, không có tên Transcribe job. Cuối bước luôn khôi phục code/environment Worker thử đã sao lưu; routing E2E cũ được giữ.
5. Triển khai Worker và OCR chính, chạy smoke test import bằng event bỏ qua. Giữ nguyên environment, Layer, queue/trigger của hai Lambda chính. Không đổi Vision, Secrets Manager hay AI queue.
6. Tạo 7 ảnh PNG có reference biết trước và gọi Rekognition DetectText tuần tự: 2 ảnh tiếng Anh, 4 ảnh tiếng Việt và 1 ảnh trắng. Lưu ảnh, reference, phản hồi gốc và CER/WER vào `reports/input-ocr/<stamp>/ocr-language/`.

## Hợp đồng đầu vào

- Giới hạn 500 MB = **500.000.000 byte**, không phải 500 MiB. M1 và M4 cần cùng dùng giá trị này. File đúng giới hạn được chấp nhận bởi kiểm tra kích thước; thêm 1 byte bị từ chối.
- Chỉ job CREATED/UPLOADED chưa có processing_version được kiểm tra mới. Worker xác minh owner/video_key và tombstone trước khi đọc S3. Không đánh dấu FAILED cho job đã tiến bước khác.
- Đọc ContentLength thật bằng HeadObject; không tin size do client/event gửi.
- Đọc header có Range và IfMatch ETag. Event có ETag/version cũ được bỏ qua, không đánh dấu lỗi cho object mới.
- Kiểm tra cấu trúc ftyp và brand MP4, không chỉ tìm chuỗi hoặc tin ContentType. Chấp nhận ContentType application/octet-stream nếu header hợp lệ; QuickTime/3GP major brand bị từ chối.
- Mã lỗi dữ liệu: VIDEO_EXTENSION_NOT_MP4, VIDEO_EMPTY_OR_INVALID_SIZE, VIDEO_TOO_LARGE, VIDEO_INVALID_MP4_HEADER. Job được cập nhật FAILED có điều kiện và message được xử lý xong; không dùng DLQ cho những lỗi dữ liệu đã xác định này.
- Lỗi S3/IAM/mạng hoặc object bị đổi trong lúc đọc không bị biến thành lỗi dữ liệu; invocation báo lỗi để cơ chế retry hiện có áp dụng.
- `input_validation` là chuỗi JSON lưu metadata kiểm tra trên Jobs, gồm kích thước, ETag, version_id nếu có, thời điểm và `container_check: FTYP_ONLY`.

**Giới hạn cần ghi vào báo cáo:** đây là kiểm tra nhanh container signature, KHÔNG xác nhận có video track, codec hợp lệ, thời lượng hoặc giải mã toàn bộ file. Một container giả có ftyp hợp lệ vẫn có thể qua; Transcribe/MediaConvert tiếp tục chịu trách nhiệm kiểm tra dịch vụ. File hợp lệ nhưng ftyp nằm ngoài 64 KiB đầu bị từ chối theo chính sách này. Kiểm tra không giải quyết race upload đè key sau khi đọc; cần M1 thống nhất key bất biến/presigned upload và retry version. Job PROCESSING_ASR cũ được tiếp tục theo cơ chế hiện có, không tự reset vì object mới.

Biên 500 MB được chứng minh bằng mock metadata; KHÔNG upload file 500 MB thật. AWS test chỉ dùng hai object lỗi rất nhỏ và một MP4 có sẵn. Smoke chính không thay thế kiểm thử UI upload đầy đủ.

## Diễn giải OCR

Code tách `ocrText.js` để evaluator dùng đúng chuẩn hóa, lọc LINE confidence >=80, thứ tự đọc và loại dòng trùng đang dùng ở OCR. Chuẩn hóa NFC/khoảng trắng, không xóa dấu. Ngưỡng không bị hạ để cải thiện kết quả. Cảnh báo `OCR_LANGUAGE_SUPPORT_LIMITED` được thêm vào transcript OCR mới; không tự suy đoán ngôn ngữ từ text.

Theo tài liệu AWS, Rekognition thiết kế nhận chữ English, Arabic, Russian, German, French, Italian, Portuguese, Spanish; tiếng Việt không có trong danh sách: https://docs.aws.amazon.com/rekognition/latest/dg/text-detection.html

- CER = số phép sửa ký tự / số ký tự reference; WER tương tự theo từ. Giá trị nhỏ hơn tốt hơn; có thể vượt 1 nếu nhiều chèn. Dấu tiếng Việt được giữ trong phép đo.
- Summary mỗi ngôn ngữ cộng số lỗi và độ dài reference trước khi chia; không lấy trung bình đơn giản các tỷ lệ.
- Lưu cả kết quả không lọc confidence để phân biệt lỗi nhận dạng với chữ bị ngưỡng loại đi.
- Ảnh trắng báo false positive riêng; CER/WER của reference rỗng là null.
- Reference chính là chuỗi dùng để vẽ ảnh, không phải nội dung do OCR/Gemini sinh. Mở PNG để kiểm tra font, dấu và bố cục trước khi diễn giải. Kết quả là probe trên ảnh tổng hợp nhỏ, không suy rộng thành độ chính xác trên toàn bộ video/thực tế.
- OCR có chữ sai vẫn đi nhánh OCR hiện tại. Chưa có kiểm định chất lượng tự động để chuyển OCR có chữ sai sang Vision; không tuyên bố đã giải quyết bài toán này.
- Nguyên trạng lấy frame 5 giây, tối đa 60 frame và FRAME_COVERAGE_TRUNCATED vẫn giữ. Đây không phải coverage toàn video hoặc benchmark mới.

Chi phí mới: tối đa 7 DetectText request trong lượt bình thường, vài request S3/Lambda/DynamoDB; retry SDK có thể thêm request. Không gọi Gemini, không tạo chủ động Transcribe/MediaConvert job trong bài đo, không đổi Secrets Manager.

## Commit khi các bước đã PASS

```powershell
git add -- m2-input-ocr index.js onFramesReady.js validateVideoInput.js workerInputGuard.js ocrText.js ocrEvaluation.js testInputOcr.js testWorkerInput.js input-validation-stack.json reports/input-ocr
git diff --cached --check
git diff --cached --stat
git commit -m "feat(pipeline): validate video size and MP4 header before ASR"
git push
```

Không add `local-input-ocr-backups/` và `local-input-ocr-build/`. Những ZIP/manifest release cũ không tự cập nhật theo thay đổi này; dùng bản đóng gói/báo cáo của lượt mới khi bàn giao, không redeploy ZIP cũ.

Bàn giao M1/M4: 500.000.000 byte, bốn mã lỗi mới, trường input_validation và cảnh báo OCR_LANGUAGE_SUPPORT_LIMITED. Bàn giao M3: giữ cảnh báo OCR khi sinh nội dung học tập; không coi confidence cao là đảm bảo chữ tiếng Việt đúng.
