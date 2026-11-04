# M2: kiểm tra ba nhánh bằng upload thật

Giải nén vào `C:\CloudTutor\cloudtutor-pipeline`, tạo thư mục `m2-three-branches`.

```powershell
cd C:\CloudTutor\cloudtutor-pipeline
powershell -NoProfile -ExecutionPolicy Bypass -File .\m2-three-branches\runThreeBranches.ps1
```

Cửa sổ yêu cầu chọn một đoạn phim/cảnh thật không có chữ, phụ đề, watermark hoặc logo. Chọn nội dung công khai/được phép dùng với Gemini. Script không sửa file gốc; cắt 12 giây đầu và thay âm thanh bằng audio im lặng. Nếu cảnh đầu có title/chữ thì kết quả OCR khác kỳ vọng là điều cần đối chiếu dữ liệu, không tự quy thành bug.

Hai video còn lại: dùng speech fixture tiếng Anh đã test nếu còn trên máy, nếu không tạo bằng Windows TTS; tạo slide chữ tiếng Anh và audio im lặng cho nhánh OCR. Không có track âm thanh và có track im lặng là hai loại input khác nhau: bài này dùng track im lặng để kiểm tra điều kiện ASR COMPLETED nhưng rỗng, không coi Transcribe FAILED là ASR rỗng.

## Thực thi

- Ba job mới `test_fixture=true`, owner test-user, source key `videos/` thật; S3 notification kích hoạt Worker chính, không invoke giả để đi tắt.
- Không đổi config/queue/Layer, không purge/redrive, không reset job cũ.
- Có chi phí Transcribe, tối đa hai MC job nếu đúng nhánh, DetectText và tối đa ba frame Vision trong điều kiện thông thường; provider/queue retry có thể thêm request.
- ASR/OCR gửi AI queue chung đang cấu hình; M3 có thể chạy tiếp và phát sinh thêm chi phí. Vision dùng AI destination hiện tại. Script chỉ đọc metadata các destination, không đổi sang queue thử.
- Có thể chạy tối đa 15 phút theo dõi; không mở nhiều lượt kiểm tra cùng lúc.
- Kết quả/thời điểm quan sát không phải benchmark từng stage chính xác: polling 10 giây, không đo queue latency riêng.

## Kết quả mong đợi

| Video | Source | Đầu ra |
|---|---|---|
| speech | ASR | normalized-transcript.json, text/segments có lời nói |
| silent-text | OCR | normalized-ocr.json, chữ trên slide, warning lấy mẫu/giới hạn ngôn ngữ |
| silent-scene | VISION | vision-cache-v{version}.json, mô tả các frame được chọn, warning mô tả AI |

PASS M2 yêu cầu source hợp lệ (schema/job/owner/version/text/segments/warnings) và checkpoint nguồn SENT. Status có thể đã thành COMPLETED hoặc FAILED phía downstream; báo cáo giữ lại trạng thái đó thay vì tự gán cho M2.

Các file trong `reports/three-branches/<run>/`: run.json, summary.json, source/job/results cho từng ca, ffprobe/media và log lọc theo job ID. Giữ file tham chiếu thật để đọc nội dung, không chỉ nhìn StatusCode 200.

Log filter theo job_id có thể bỏ sót stack trace không có job ID. Khi cần, dùng RequestId/logStreamName trong log để mở đúng invocation trên CloudWatch và xem lỗi đầu tiên. Báo cáo chỉ gợi ý vùng trách nhiệm; chưa xác định nguyên nhân thì không tự kết luận M2/M3.

## Khi lỗi/timeout hoặc chờ quota

Không chạy lại lượt upload. Tiếp tục đọc đúng job cũ:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\m2-three-branches\runThreeBranches.ps1 -ResumeReport "C:\CloudTutor\cloudtutor-pipeline\reports\three-branches\<run>"
```

Resume không tạo lại job/upload. Nếu lượt trước dừng ở lúc chuẩn bị/upload và có case chưa upload, báo cáo có thể hiện missing/stale; cần review run.json, không tự tiếp tục upload mù quáng.

`NO_USEFUL_SELECTED_FRAMES` là kết quả nghiệp vụ đối với các frame đã chọn, không khẳng định phim hoàn toàn không có nội dung. `BRANCH_DIFFERS_REVIEW_INPUT` có thể do phim có chữ hoặc ASR nhận ra nội dung; đọc raw/normalized trước khi sửa code. Quota/provider lỗi cũng không đồng nghĩa lỗi lập trình.

## Ai sửa validation

- Input size/header/Jobs version, Transcribe, MediaConvert, OCR, Gemini Vision hoặc message M2 không đúng contract: M2 điều tra/sửa phần mình.
- Nguồn M2 đúng nhưng chunk/Summary/Quiz/Q&A, schema model AI hoặc consumer đọc sai source/version: M3.
- Lỗi dữ liệu/API owner/key/version do API tạo: M1 phối hợp M2.
- UI/mốc hiển thị hoặc upload browser: M4 phối hợp M1.
- Chỉ có chữ ValidationException/ValidationError chưa đủ giao lỗi cho ai; cần tên Lambda, stage, request/model và trường bị từ chối. Lỗi Gemini JSON trong Vision thuộc M2; cùng lỗi đó trong Summary/Quiz thuộc M3.

Không kết luận AI DLQ hiện tại là do test mới hoặc do M2 nếu chưa đối chiếu job_id và log. Không đánh dấu toàn hệ thống PASS chỉ từ M2_PASS.
