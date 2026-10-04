import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { createJob, uploadToS3 } from '../api/jobs';
import {
  UploadCloud,
  FileVideo,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Server,
  Cloud,
  Layers,
  Sparkles,
  Info,
  BookOpen,
  MessageSquareQuote,
  Lightbulb,
  PlayCircle,
  Clock
} from 'lucide-react';

export function UploadPage() {
  const { idToken, user } = useAuth();
  const navigate = useNavigate();

  const [file, setFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState('');
  
  // Tab guide state: 'upload' | 'qa'
  const [guideTab, setGuideTab] = useState('upload');

  // Upload lifecycle state: 'IDLE' | 'CREATING_JOB' | 'UPLOADING_S3' | 'SUCCESS' | 'ERROR'
  const [uploadState, setUploadState] = useState('IDLE');
  const [progress, setProgress] = useState(0);
  const [jobInfo, setJobInfo] = useState(null);

  const fileInputRef = useRef(null);
  const abortControllerRef = useRef(null);

  // Validate selected file
  const handleValidateAndSetFile = (selectedFile) => {
    setError('');
    if (!selectedFile) return;

    if (!selectedFile.type.includes('video') && !selectedFile.name.endsWith('.mp4')) {
      setError('Hệ thống hiện tại ưu tiên định dạng video .mp4 cho tuần 1');
      return;
    }

    // Limit to 500MB for safe uploads
    if (selectedFile.size > 500 * 1024 * 1024) {
      setError('Dung lượng tệp vượt quá giới hạn 500MB');
      return;
    }

    setFile(selectedFile);
  };

  // Drag and drop handlers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleValidateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  // Quick Demo: inject simulated MP4 file so user doesn't need to look for a real file
  const handleUseMockSample = () => {
    const mockBlob = new Blob(['mock video content bytes - CloudTutor AWS Demo Lecture'], { type: 'video/mp4' });
    const mockFile = new File([mockBlob], 'AWS_Cloud_Computing_Distributed_Systems_Lec01.mp4', {
      type: 'video/mp4',
      lastModified: Date.now()
    });
    // Add artificial size for realistic UI display (~38.4 MB)
    Object.defineProperty(mockFile, 'size', { value: 38450120 });
    setFile(mockFile);
    setError('');
  };

  // Main submission flow: Step 1 POST /jobs -> Step 2 PUT S3
  const handleStartUpload = async () => {
    if (!file) return;

    setError('');
    setProgress(0);
    setUploadState('CREATING_JOB');

    abortControllerRef.current = new AbortController();

    try {
      // Step 1: Create Lecture Job via API Gateway
      const jobData = await createJob({
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type || 'video/mp4',
        token: idToken
      });

      setJobInfo(jobData);
      setUploadState('UPLOADING_S3');

      // Step 2: Direct Binary PUT to S3 using Presigned URL
      await uploadToS3(
        jobData.presigned_url,
        file,
        (percent) => setProgress(percent),
        abortControllerRef.current.signal
      );

      setUploadState('SUCCESS');
    } catch (err) {
      console.error('Upload flow failed:', err);
      setError(err.message || 'Xảy ra lỗi trong quá trình upload video');
      setUploadState('ERROR');
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setUploadState('IDLE');
    setProgress(0);
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {/* Page Title */}
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          Tải lên bài giảng (Lecture Package)
        </h1>
        <p className="text-slate-500 mt-1.5 text-sm sm:text-base">
          Tuần 1: Khởi tạo Job Manifest và truyền trực tiếp video lên Amazon S3 qua Presigned URL an toàn.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Upload Box */}
        <div className="lg:col-span-2 space-y-6">
          {uploadState === 'SUCCESS' ? (
            /* Success State */
            <div className="bg-white rounded-2xl p-8 border border-emerald-200/80 shadow-lg shadow-emerald-500/5 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-4 animate-bounce">
                <CheckCircle2 className="w-9 h-9" />
              </div>
              <h2 className="text-xl font-bold text-slate-900">
                Tải lên Amazon S3 thành công!
              </h2>
              <p className="text-sm text-slate-600 mt-2 max-w-md mx-auto">
                Tệp video đã được lưu an toàn tại S3 bucket và thông báo S3 Event đã được gửi tới hàng đợi SQS.
              </p>

              {/* Upload Details Card */}
              {jobInfo && (
                <div className="mt-6 p-4 bg-slate-50 rounded-xl text-left border border-slate-200 text-xs font-mono space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Job ID:</span>
                    <span className="font-bold text-indigo-700">{jobInfo.job_id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tệp:</span>
                    <span className="text-slate-800 truncate max-w-[240px]">{file?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">S3 Key:</span>
                    <span className="text-slate-700 truncate max-w-[240px]">{jobInfo.s3_key}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Trạng thái:</span>
                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">
                      UPLOADED (Sẵn sàng cho Week 2)
                    </span>
                  </div>
                </div>
              )}

              <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  onClick={() => {
                    setUploadState('IDLE');
                    setFile(null);
                    setProgress(0);
                    setJobInfo(null);
                  }}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-medium transition-colors"
                >
                  Tải lên video khác
                </button>
                <button
                  onClick={() => navigate('/jobs')}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-md shadow-indigo-200 transition-colors flex items-center justify-center space-x-1.5"
                >
                  <span>Xem thư viện bài giảng</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            /* Upload Input & Progress Box */
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
              {/* Drag Drop Area */}
              <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => !file && fileInputRef.current?.click()}
                className={`relative border-2 border-dashed rounded-2xl p-8 sm:p-10 text-center transition-all cursor-pointer ${
                  dragActive
                    ? 'border-indigo-500 bg-indigo-50/50 scale-[0.99]'
                    : file
                    ? 'border-indigo-200 bg-indigo-50/20'
                    : 'border-slate-300 hover:border-indigo-400 hover:bg-slate-50/60'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleValidateAndSetFile(e.target.files[0]);
                    }
                  }}
                />

                {file ? (
                  <div className="flex flex-col items-center">
                    <div className="w-14 h-14 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center mb-3 shadow-inner">
                      <FileVideo className="w-7 h-7" />
                    </div>
                    <span className="font-semibold text-slate-800 text-base max-w-md truncate">
                      {file.name}
                    </span>
                    <span className="text-xs text-slate-500 mt-1">
                      {formatFileSize(file.size)} • Định dạng MP4
                    </span>

                    {uploadState === 'IDLE' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFile(null);
                        }}
                        className="mt-3 text-xs text-rose-600 hover:text-rose-700 font-medium underline"
                      >
                        Chọn tệp khác
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mb-3">
                      <UploadCloud className="w-7 h-7" />
                    </div>
                    <p className="text-base font-semibold text-slate-700">
                      Kéo thả tệp video vào đây, hoặc <span className="text-indigo-600">chọn từ máy tính</span>
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Hỗ trợ MP4 (Tối đa 500MB)
                    </p>
                  </div>
                )}
              </div>

              {/* Sample preset button */}
              {!file && (
                <div className="mt-4 flex items-center justify-between text-xs bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-amber-500" />
                    Chưa có sẵn video trên máy?
                  </span>
                  <button
                    type="button"
                    onClick={handleUseMockSample}
                    className="font-semibold text-indigo-600 hover:text-indigo-700 hover:underline"
                  >
                    Dùng tệp bài giảng mẫu (38.4 MB)
                  </button>
                </div>
              )}

              {/* Error display */}
              {error && (
                <div className="mt-4 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs sm:text-sm flex items-start space-x-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Active Uploading Status Bar */}
              {(uploadState === 'CREATING_JOB' || uploadState === 'UPLOADING_S3') && (
                <div className="mt-6 p-4 bg-indigo-50/50 rounded-xl border border-indigo-100 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-indigo-900 flex items-center gap-1.5">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                      {uploadState === 'CREATING_JOB'
                        ? 'Đang tạo Job Manifest trên API Gateway & DynamoDB...'
                        : `Đang tải lên Amazon S3 qua Presigned URL... (${progress}%)`}
                    </span>
                    <span className="font-mono font-bold text-indigo-700">{progress}%</span>
                  </div>

                  {/* Progress bar track */}
                  <div className="w-full h-2.5 bg-indigo-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-500 to-violet-600 transition-all duration-300 rounded-full"
                      style={{ width: `${progress}%` }}
                    />
                  </div>

                  <div className="flex justify-between items-center text-[11px] text-slate-500 pt-1">
                    <span>Chuẩn: Direct Client-to-S3 PUT</span>
                    <button
                      type="button"
                      onClick={handleCancel}
                      className="text-rose-600 hover:underline font-medium"
                    >
                      Hủy bỏ
                    </button>
                  </div>
                </div>
              )}

              {/* Action Button */}
              {uploadState === 'IDLE' && (
                <div className="mt-6 flex justify-end">
                  <button
                    disabled={!file}
                    onClick={handleStartUpload}
                    className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm shadow-lg shadow-indigo-200 transition-all flex items-center justify-center space-x-2"
                  >
                    <UploadCloud className="w-4 h-4" />
                    <span>Bắt đầu tạo Job & Tải lên S3</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: User Guide (Upload & Q&A) */}
        <div className="space-y-5">
          {/* Guide Card Container */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Header & Tab Switcher */}
            <div className="p-5 pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2.5 mb-3">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                  <BookOpen className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">
                    Hướng dẫn sử dụng
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Thao tác từng bước trên CloudTutor
                  </p>
                </div>
              </div>

              {/* Segmented Tab Switcher */}
              <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-xl text-xs font-semibold text-slate-600">
                <button
                  type="button"
                  onClick={() => setGuideTab('upload')}
                  className={`flex items-center justify-center space-x-1.5 py-1.5 px-2 rounded-lg transition-all ${
                    guideTab === 'upload'
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'hover:text-slate-900'
                  }`}
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>1. Upload Video</span>
                </button>
                <button
                  type="button"
                  onClick={() => setGuideTab('qa')}
                  className={`flex items-center justify-center space-x-1.5 py-1.5 px-2 rounded-lg transition-all ${
                    guideTab === 'qa'
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'hover:text-slate-900'
                  }`}
                >
                  <MessageSquareQuote className="w-3.5 h-3.5" />
                  <span>2. Hỏi đáp Q&A</span>
                </button>
              </div>
            </div>

            {/* Tab 1: Hướng dẫn Upload Video */}
            {guideTab === 'upload' && (
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-900 uppercase tracking-wider">
                    Quy trình tải lên video
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-semibold border border-indigo-100">
                    3 Bước
                  </span>
                </div>

                <div className="space-y-3 text-xs">
                  {/* Step 1 */}
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 hover:border-indigo-100 transition-colors">
                    <div className="flex items-center space-x-2 mb-1">
                      <div className="w-5 h-5 rounded-md bg-indigo-600 text-white flex items-center justify-center font-bold text-[11px] flex-shrink-0">
                        1
                      </div>
                      <span className="font-semibold text-slate-800 text-xs">
                        Chọn tệp bài giảng (.mp4)
                      </span>
                    </div>
                    <p className="text-slate-500 pl-7 leading-relaxed text-[11px]">
                      Kéo thả file video vào ô tải lên hoặc bấm duyệt từ máy tính (hỗ trợ tối đa 500MB).
                    </p>
                    <div className="mt-2 ml-7 inline-flex items-center gap-1 text-[10px] text-amber-800 bg-amber-50 px-2 py-0.5 rounded font-medium border border-amber-200/60">
                      <Sparkles className="w-3 h-3 text-amber-500" />
                      Mẹo: Bấm <b>"Dùng tệp bài giảng mẫu"</b> để test nhanh
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 hover:border-indigo-100 transition-colors">
                    <div className="flex items-center space-x-2 mb-1">
                      <div className="w-5 h-5 rounded-md bg-indigo-600 text-white flex items-center justify-center font-bold text-[11px] flex-shrink-0">
                        2
                      </div>
                      <span className="font-semibold text-slate-800 text-xs">
                        Khởi tạo Job & Tải lên S3
                      </span>
                    </div>
                    <p className="text-slate-500 pl-7 leading-relaxed text-[11px]">
                      Bấm nút <b className="text-slate-700">"Bắt đầu tạo Job & Tải lên S3"</b>. Hệ thống sẽ sinh Presigned URL bảo mật và truyền thẳng video lên Amazon S3.
                    </p>
                  </div>

                  {/* Step 3 */}
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 hover:border-indigo-100 transition-colors">
                    <div className="flex items-center space-x-2 mb-1">
                      <div className="w-5 h-5 rounded-md bg-indigo-600 text-white flex items-center justify-center font-bold text-[11px] flex-shrink-0">
                        3
                      </div>
                      <span className="font-semibold text-slate-800 text-xs">
                        Theo dõi & Kiểm tra Thư viện
                      </span>
                    </div>
                    <p className="text-slate-500 pl-7 leading-relaxed text-[11px]">
                      Xem tiến độ tải lên theo thời gian thực (0% → 100%). Sau khi hoàn thành, chuyển sang mục <b className="text-indigo-600">"Thư viện Video"</b> để theo dõi trạng thái xử lý AI của bài giảng.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: Hướng dẫn Sử dụng Q&A */}
            {guideTab === 'qa' && (
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-violet-900 uppercase tracking-wider">
                    Hướng dẫn Trợ lý Q&A bài giảng
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 font-semibold border border-violet-100">
                    AI RAG
                  </span>
                </div>

                <div className="space-y-3 text-xs">
                  {/* Step 1 */}
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 hover:border-violet-100 transition-colors">
                    <div className="flex items-center space-x-2 mb-1">
                      <div className="w-5 h-5 rounded-md bg-violet-600 text-white flex items-center justify-center font-bold text-[11px] flex-shrink-0">
                        1
                      </div>
                      <span className="font-semibold text-slate-800 text-xs">
                        Mở bài giảng từ Thư viện
                      </span>
                    </div>
                    <p className="text-slate-500 pl-7 leading-relaxed text-[11px]">
                      Truy cập menu <b className="text-slate-700">"Thư viện Video"</b>, nhấp chọn bài giảng đã xử lý hoàn tất (<span className="text-emerald-700 font-semibold">COMPLETED</span>).
                    </p>
                  </div>

                  {/* Step 2 */}
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 hover:border-violet-100 transition-colors">
                    <div className="flex items-center space-x-2 mb-1">
                      <div className="w-5 h-5 rounded-md bg-violet-600 text-white flex items-center justify-center font-bold text-[11px] flex-shrink-0">
                        2
                      </div>
                      <span className="font-semibold text-slate-800 text-xs">
                        Đặt câu hỏi vào khung Chat
                      </span>
                    </div>
                    <p className="text-slate-500 pl-7 leading-relaxed text-[11px]">
                      Gõ câu hỏi bất kỳ về nội dung bài học (ví dụ: <i>"Định lý CAP là gì?"</i>, <i>"Tóm tắt 3 luận điểm chính"</i>).
                    </p>
                  </div>

                  {/* Step 3 */}
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 hover:border-violet-100 transition-colors">
                    <div className="flex items-center space-x-2 mb-1">
                      <div className="w-5 h-5 rounded-md bg-violet-600 text-white flex items-center justify-center font-bold text-[11px] flex-shrink-0">
                        3
                      </div>
                      <span className="font-semibold text-slate-800 text-xs">
                        Xem lời giải kèm Mốc nguồn (Citation)
                      </span>
                    </div>
                    <p className="text-slate-500 pl-7 leading-relaxed text-[11px]">
                      Mô hình AI trích xuất nội dung từ Transcript/Slide để trả lời kèm mốc thời gian (ví dụ: <span className="font-mono text-indigo-700 bg-indigo-50 px-1 py-0.5 rounded font-semibold">[00:15:30]</span>). <b>Nhấp vào mốc thời gian để video tự động phát ngay đoạn đó!</b>
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Quick Tip Box */}
          <div className="bg-gradient-to-br from-indigo-50/90 to-purple-50/70 rounded-2xl border border-indigo-100/80 p-4 text-xs">
            <div className="flex items-start space-x-2.5">
              <Lightbulb className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-indigo-950 block mb-0.5">
                  Mẹo tra cứu nhanh với RAG
                </span>
                <p className="text-slate-600 text-[11px] leading-relaxed">
                  Trợ lý Q&A đối chiếu chính xác dữ liệu từ nội dung video đã upload, hạn chế tối đa hallucination (nói sai lệch) và giúp bạn ôn thi, tra cứu kiến thức trong vài giây.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
