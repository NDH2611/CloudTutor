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
  Info
} from 'lucide-react';

export function UploadPage() {
  const { idToken, user } = useAuth();
  const navigate = useNavigate();

  const [file, setFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState('');
  
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

        {/* Right Column: Architectural Flow & Week 1 Checklist */}
        <div className="space-y-6">
          {/* Architecture Explainer Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2 mb-4">
              <Layers className="w-4 h-4 text-indigo-600" />
              Luồng kiến trúc Tuần 1 (End-to-End)
            </h3>
            
            <div className="space-y-4 text-xs">
              <div className="flex items-start space-x-3">
                <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-[11px] flex-shrink-0 mt-0.5">
                  1
                </div>
                <div>
                  <span className="font-semibold text-slate-800">Xác thực Cognito</span>
                  <p className="text-slate-500 mt-0.5">Lấy JWT token đính kèm trong header `Authorization: Bearer &lt;idToken&gt;`.</p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-[11px] flex-shrink-0 mt-0.5">
                  2
                </div>
                <div>
                  <span className="font-semibold text-slate-800">Khởi tạo Job Manifest</span>
                  <p className="text-slate-500 mt-0.5">Gọi `POST /jobs` tới API Gateway. DynamoDB ghi nhận status `CREATED`, trả về Presigned URL.</p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-[11px] flex-shrink-0 mt-0.5">
                  3
                </div>
                <div>
                  <span className="font-semibold text-slate-800">Direct S3 Upload</span>
                  <p className="text-slate-500 mt-0.5">Frontend PUT trực tiếp video lên Amazon S3 bucket, không đi qua server để tối ưu băng thông.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Member 4 Responsibility Checklist */}
          <div className="bg-indigo-50/60 rounded-2xl border border-indigo-100 p-6">
            <h3 className="font-bold text-indigo-950 text-sm flex items-center gap-2 mb-3">
              <Info className="w-4 h-4 text-indigo-600" />
              Nhiệm vụ Thành viên 4 (Frontend)
            </h3>
            <ul className="text-xs text-indigo-900/80 space-y-2">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span>Khởi tạo khung ứng dụng React + Vite + Tailwind CSS</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span>Trang Đăng ký / Đăng nhập tích hợp Cognito SDK</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span>Trang Upload: gọi POST /jobs & PUT S3 presigned URL</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span>Chế độ Mock dữ liệu song hành với Backend Member 1</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
