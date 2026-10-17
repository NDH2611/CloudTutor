import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getJobDetail } from '../api/jobs';
import {
  ArrowLeft,
  RefreshCw,
  Play,
  Pause,
  Clock,
  FileText,
  BookOpen,
  HelpCircle,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Layers,
  Sparkles,
  Volume2,
  Image,
  ChevronRight,
  RotateCcw,
  Search,
  Check,
  Cpu
} from 'lucide-react';

export function VideoDetailPage() {
  const { id: jobId } = useParams();
  const { idToken } = useAuth();

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('transcript'); // 'transcript' | 'summary' | 'quiz'

  // Video Player state
  const videoRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [searchChunk, setSearchChunk] = useState('');

  // Quiz state: { [questionIndex]: selectedOptionIndex }
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);

  // Load / Polling function
  const loadDetail = async (showLoadingSpinner = false) => {
    if (showLoadingSpinner) setLoading(true);
    try {
      const data = await getJobDetail(jobId, idToken);
      setJob(data);
      setError('');
    } catch (err) {
      console.error('Failed to load job detail:', err);
      setError(err.response?.data?.error || err.message || 'Không thể tải chi tiết bài giảng');
    } finally {
      if (showLoadingSpinner) setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    loadDetail(true);
  }, [jobId]);

  // Smart Short Polling: Automatically poll every 3.5s if job is in active processing states
  useEffect(() => {
    if (!job) return;
    const isProcessing = ['CREATED', 'QUEUED', 'TRANSCRIBING', 'PROCESSING_OCR', 'PROCESSING_AI'].includes(job.status);
    if (!isProcessing) return;

    const interval = setInterval(() => {
      loadDetail(false);
    }, 3500);

    return () => clearInterval(interval);
  }, [job?.status, jobId]);

  // Catch Video Player error (e.g. S3 presigned URL expired after 15 minutes) and renew seamlessly
  const handleVideoError = async () => {
    console.warn('Video URL may have expired or failed to stream. Fetching fresh presigned URL from API Gateway...');
    const savedTime = videoRef.current?.currentTime || 0;
    try {
      const updated = await getJobDetail(jobId, idToken);
      setJob(updated);
      if (videoRef.current && updated.video_url) {
        videoRef.current.src = updated.video_url;
        videoRef.current.currentTime = savedTime;
        videoRef.current.play().catch(() => {});
      }
    } catch (err) {
      console.error('Failed to renew video presigned URL:', err);
    }
  };

  // Video time update listener
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  // Seek video when clicking a transcript chunk
  const handleSeek = (seconds) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, seconds);
      videoRef.current.play().catch(() => {});
    }
  };

  // Format seconds to mm:ss
  const formatTime = (seconds) => {
    if (typeof seconds !== 'number' || isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Friendly warning explanations
  const translateWarning = (warningCode) => {
    switch (warningCode) {
      case 'ASR_EMPTY':
        return 'Video không có âm thanh giọng nói. Hệ thống đã tự động chuyển sang OCR trích xuất chữ từ hình ảnh slide.';
      case 'OCR_TIMESTAMPS_ARE_SAMPLED':
        return 'Các mốc thời gian bài giảng được lấy mẫu chu kỳ từ khung hình video (5s/frame).';
      case 'OCR_TEXT_REQUIRES_REVIEW':
        return 'Văn bản được trích xuất tự động qua OCR từ khung hình video, bạn nên rà soát lại các ký tự toán học/ký hiệu.';
      case 'FRAME_COVERAGE_TRUNCATED':
        return 'Video dài hơn mức trích xuất khung hình tối đa của phiên thử nghiệm.';
      default:
        return `Cảnh báo hệ thống: ${warningCode}`;
    }
  };

  // Stepper calculations for in-progress pipeline
  const getStepStatus = (stepIndex) => {
    if (!job) return 'upcoming';
    const status = job.status;

    // Steps: 0: Uploaded, 1: Transcribing/OCR, 2: AI Processing, 3: Completed
    if (status === 'COMPLETED' || status === 'COMPLETED_WITH_WARNING') return 'completed';
    if (status === 'FAILED') return 'failed';

    if (stepIndex === 0) return 'completed'; // S3 upload is already done if job exists
    if (stepIndex === 1) {
      if (status === 'QUEUED' || status === 'TRANSCRIBING' || status === 'PROCESSING_OCR') return 'current';
      if (status === 'PROCESSING_AI') return 'completed';
    }
    if (stepIndex === 2) {
      if (status === 'PROCESSING_AI') return 'current';
    }
    return 'upcoming';
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 text-center">
        <RefreshCw className="w-10 h-10 animate-spin text-indigo-600 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-800">Đang đồng bộ dữ liệu bài giảng từ AWS...</h2>
        <p className="text-sm text-slate-500 mt-2">Truy vấn trạng thái DynamoDB và kết quả học liệu S3.</p>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <AlertTriangle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-900">Không tìm thấy bài giảng</h2>
        <p className="text-sm text-slate-500 mt-2">{error || 'Bài giảng không tồn tại hoặc bạn không có quyền truy cập.'}</p>
        <Link
          to="/videos"
          className="inline-flex items-center gap-2 mt-6 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Quay lại Thư viện</span>
        </Link>
      </div>
    );
  }

  const isProcessing = ['CREATED', 'QUEUED', 'TRANSCRIBING', 'PROCESSING_OCR', 'PROCESSING_AI'].includes(job.status);
  const isCompleted = ['COMPLETED', 'COMPLETED_WITH_WARNING'].includes(job.status);
  const chunks = job.chunks || [];
  const summary = job.summary || null;
  const quiz = job.quiz || null;

  // Filter chunks based on search
  const filteredChunks = chunks.filter((c) =>
    (c.text || '').toLowerCase().includes(searchChunk.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Navigation & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Link
            to="/videos"
            className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors"
            title="Quay lại Thư viện bài giảng"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
                {job.original_filename || job.file_name || 'Chi tiết bài giảng'}
              </h1>
              {/* Content Source Badge */}
              {job.content_source === 'OCR' ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                  <Image className="w-3 h-3 text-purple-600" />
                  OCR Fallback (Khung hình)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  <Volume2 className="w-3 h-3 text-blue-600" />
                  ASR (Giọng nói)
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 font-mono mt-1 flex items-center gap-2">
              <span>Job ID: {job.job_id}</span>
              <span>•</span>
              <span>{job.created_at ? new Date(job.created_at).toLocaleString('vi-VN') : ''}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => loadDetail(false)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 text-xs font-semibold shadow-sm transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin text-indigo-600' : ''}`} />
            <span>Làm mới trạng thái</span>
          </button>
        </div>
      </div>

      {/* Warning Banner if COMPLETED_WITH_WARNING or has warnings */}
      {job.warnings && job.warnings.length > 0 && (
        <div className="mb-6 p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-start gap-3 shadow-sm">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-xs text-amber-900">
            <h4 className="font-bold text-sm text-amber-950 mb-1">
              Bài giảng xử lý hoàn tất có cảnh báo (COMPLETED_WITH_WARNING)
            </h4>
            <ul className="list-disc list-inside space-y-1">
              {job.warnings.map((w, idx) => (
                <li key={idx}>{translateWarning(w)}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* In-Progress Pipeline Stepper View */}
      {isProcessing && (
        <div className="mb-8 p-6 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                Pipeline Đang Xử Lý Bất Đồng Bộ Trên Cloud
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Trang này tự động thăm dò (Short Polling mỗi 3.5s). Toàn bộ học liệu sẽ tự xuất hiện khi xử lý xong.
              </p>
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200">
              {job.status}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mt-6">
            {[
              { title: '1. S3 Video Ingest', desc: 'S3 Event đẩy vào hàng đợi SQS' },
              { title: '2. Transcribe / OCR', desc: 'Tách lời nói hoặc bóc khung hình' },
              { title: '3. Bedrock AI', desc: 'Sinh Summary & Bộ câu hỏi Quiz' },
              { title: '4. Sẵn sàng học tập', desc: 'Lưu kết quả DynamoDB Results' }
            ].map((step, idx) => {
              const status = getStepStatus(idx);
              return (
                <div
                  key={idx}
                  className={`p-4 rounded-xl border transition-all ${
                    status === 'completed'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : status === 'current'
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-900 ring-2 ring-indigo-200 shadow-sm'
                      : 'bg-slate-50 border-slate-200 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold">{step.title}</span>
                    {status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                    {status === 'current' && <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />}
                  </div>
                  <p className="text-[11px] leading-relaxed opacity-80">{step.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Content Layout: Video Player + Interactive Learning Hub */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Video Player & Meta */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          <div className="bg-black rounded-2xl overflow-hidden shadow-lg border border-slate-800 aspect-video relative group">
            {job.video_url ? (
              <video
                ref={videoRef}
                src={job.video_url}
                controls
                className="w-full h-full object-contain"
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
                onError={handleVideoError}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-6 text-center">
                <Layers className="w-12 h-12 mb-2 text-slate-600 animate-pulse" />
                <p className="text-sm font-semibold">Đang chuẩn bị đường dẫn xem video an toàn từ S3...</p>
              </div>
            )}
          </div>

          {/* Quick Playback Bar & Sync Info */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex items-center justify-between text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-600" />
              <span>Thời gian phát:</span>
              <span className="font-mono font-bold text-slate-900 text-sm">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
              <span>Đồng bộ mốc thời gian thời gian thực</span>
            </div>
          </div>
        </div>

        {/* Right Column: Multi-tab Study Hub (Transcript, Summary, Quiz) */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[650px] overflow-hidden">
          {/* Tabs Navigation */}
          <div className="flex items-center border-b border-slate-200 bg-slate-50/70 p-1.5 gap-1">
            <button
              onClick={() => setActiveTab('transcript')}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'transcript'
                  ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>Transcript</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {chunks.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('summary')}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'summary'
                  ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>Tóm tắt AI</span>
            </button>

            <button
              onClick={() => setActiveTab('quiz')}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'quiz'
                  ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <HelpCircle className="w-4 h-4" />
              <span>Trắc nghiệm</span>
              {quiz?.questions?.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  {quiz.questions.length}
                </span>
              )}
            </button>
          </div>

          {/* Tab 1: Interactive Transcript Chunks */}
          {activeTab === 'transcript' && (
            <div className="flex-1 flex flex-col p-4 overflow-hidden">
              {/* Search Chunks */}
              <div className="relative mb-3">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Tìm từ khóa trong bài giảng..."
                  value={searchChunk}
                  onChange={(e) => setSearchChunk(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
              </div>

              {/* Chunks List */}
              <div className="flex-1 overflow-y-auto pr-1 space-y-2.5">
                {filteredChunks.length === 0 ? (
                  <div className="text-center py-12 text-slate-400 text-xs">
                    {chunks.length === 0
                      ? isProcessing
                        ? 'Đang trích xuất nội dung... Dữ liệu sẽ hiển thị ngay khi hoàn tất.'
                        : 'Không có dữ liệu transcript cho bài giảng này.'
                      : 'Không tìm thấy đoạn nội dung phù hợp với từ khóa.'}
                  </div>
                ) : (
                  filteredChunks.map((chunk, idx) => {
                    const isActive =
                      currentTime >= (chunk.start_time || 0) &&
                      currentTime <= (chunk.end_time || (chunk.start_time || 0) + 5);

                    return (
                      <div
                        key={chunk.chunk_id || idx}
                        onClick={() => handleSeek(chunk.start_time)}
                        className={`p-3 rounded-xl border cursor-pointer transition-all ${
                          isActive
                            ? 'bg-indigo-50/80 border-indigo-300 ring-2 ring-indigo-200 shadow-sm'
                            : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px] mb-1.5">
                          <span
                            className={`font-mono font-bold flex items-center gap-1 ${
                              isActive ? 'text-indigo-700' : 'text-slate-500'
                            }`}
                          >
                            <Play className="w-2.5 h-2.5 fill-current" />
                            {formatTime(chunk.start_time)} - {formatTime(chunk.end_time)}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {chunk.source || (job.content_source === 'OCR' ? 'OCR' : 'ASR')}
                          </span>
                        </div>
                        <p className="text-xs text-slate-800 leading-relaxed whitespace-pre-line">
                          {chunk.text}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Tab 2: Bedrock AI Summary */}
          {activeTab === 'summary' && (
            <div className="flex-1 p-5 overflow-y-auto">
              {!summary ? (
                <div className="text-center py-16 text-slate-400 text-xs">
                  {isProcessing
                    ? 'Amazon Bedrock đang phân tích nội dung và sinh tóm tắt bài giảng...'
                    : 'Chưa có bản tóm tắt cho bài giảng này.'}
                </div>
              ) : (
                <div className="space-y-4 text-xs text-slate-700 leading-relaxed">
                  <div className="p-4 rounded-xl bg-indigo-50/60 border border-indigo-100">
                    <h3 className="font-extrabold text-sm text-indigo-950 mb-1">
                      {summary.title || 'Tóm Tắt Tổng Quan'}
                    </h3>
                    <p className="text-slate-700">{summary.overview}</p>
                  </div>

                  {summary.key_points && summary.key_points.length > 0 && (
                    <div>
                      <h4 className="font-bold text-slate-900 mb-2 flex items-center gap-1.5 text-xs">
                        <Check className="w-4 h-4 text-emerald-600" />
                        Các điểm kiến thức cốt lõi (Key Points)
                      </h4>
                      <ul className="space-y-2">
                        {summary.key_points.map((pt, i) => (
                          <li key={i} className="flex items-start gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                            <span className="w-4 h-4 rounded-full bg-indigo-100 text-indigo-700 font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                              {i + 1}
                            </span>
                            <span>{pt}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {summary.recommendations && (
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                      <span className="font-bold text-slate-800 block mb-1">💡 Lưu ý quan trọng:</span>
                      <p className="text-slate-600 text-[11px]">{summary.recommendations}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Interactive Quiz */}
          {activeTab === 'quiz' && (
            <div className="flex-1 p-5 overflow-y-auto flex flex-col justify-between">
              {!quiz || !quiz.questions || quiz.questions.length === 0 ? (
                <div className="text-center py-16 text-slate-400 text-xs">
                  {isProcessing
                    ? 'Bedrock AI đang biên soạn câu hỏi ôn tập trắc nghiệm...'
                    : 'Chưa có bộ câu hỏi trắc nghiệm cho bài giảng này.'}
                </div>
              ) : (
                <div className="space-y-6">
                  {quiz.questions.map((q, qIndex) => {
                    const selected = quizAnswers[qIndex];
                    const isCorrect = selected === q.correct_index;

                    return (
                      <div key={q.id || qIndex} className="p-4 rounded-xl border border-slate-200 bg-white">
                        <h4 className="font-bold text-xs text-slate-900 mb-3 flex items-start gap-2">
                          <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-mono text-[11px] shrink-0">
                            Câu {qIndex + 1}
                          </span>
                          <span>{q.question}</span>
                        </h4>

                        <div className="space-y-2">
                          {q.options.map((opt, optIndex) => {
                            let optionClass = 'border-slate-200 bg-slate-50/50 hover:bg-slate-100';
                            if (quizSubmitted) {
                              if (optIndex === q.correct_index) {
                                optionClass = 'border-emerald-500 bg-emerald-50 text-emerald-900 font-semibold';
                              } else if (selected === optIndex && !isCorrect) {
                                optionClass = 'border-rose-400 bg-rose-50 text-rose-900';
                              }
                            } else if (selected === optIndex) {
                              optionClass = 'border-indigo-600 bg-indigo-50/70 text-indigo-900 font-medium ring-1 ring-indigo-500';
                            }

                            return (
                              <button
                                key={optIndex}
                                type="button"
                                disabled={quizSubmitted}
                                onClick={() =>
                                  setQuizAnswers((prev) => ({ ...prev, [qIndex]: optIndex }))
                                }
                                className={`w-full text-left p-2.5 rounded-xl border text-xs transition-all flex items-center justify-between ${optionClass}`}
                              >
                                <span>{opt}</span>
                                {quizSubmitted && optIndex === q.correct_index && (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                )}
                                {quizSubmitted && selected === optIndex && !isCorrect && (
                                  <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                                )}
                              </button>
                            );
                          })}
                        </div>

                        {/* Explanation after submit */}
                        {quizSubmitted && q.explanation && (
                          <div className="mt-3 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600">
                            <span className="font-bold text-slate-700">Giải thích: </span>
                            {q.explanation}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Submit / Reset Actions */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                    {quizSubmitted ? (
                      <div className="flex items-center justify-between w-full">
                        <span className="text-xs font-bold text-slate-800">
                          Kết quả:{' '}
                          {
                            Object.entries(quizAnswers).filter(
                              ([idx, ans]) => ans === quiz.questions[idx]?.correct_index
                            ).length
                          }{' '}
                          / {quiz.questions.length} câu đúng
                        </span>
                        <button
                          onClick={() => {
                            setQuizAnswers({});
                            setQuizSubmitted(false);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Làm lại Quiz</span>
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setQuizSubmitted(true)}
                        disabled={Object.keys(quizAnswers).length < quiz.questions.length}
                        className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs shadow-md shadow-indigo-200 transition-all text-center"
                      >
                        Nộp bài & Kiểm tra đáp án
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
export default VideoDetailPage;
