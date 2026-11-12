import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getJobDetail, getPublicShareDetail, askJobQuestion } from '../api/jobs';
import { ShareModal } from '../components/ShareModal';
import { FormattedAiMessage } from '../components/FormattedAiMessage';
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
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Search,
  Check,
  Cpu,
  Share2,
  MessageSquare,
  Send,
  Bot,
  User,
  Trash2,
  Loader2,
  ExternalLink
} from 'lucide-react';

export function VideoDetailPage({ isPublicShare = false }) {
  const { id: jobIdParam, token: shareTokenParam } = useParams();
  const { idToken } = useAuth();

  const isPublic = Boolean(isPublicShare || shareTokenParam);
  const shareToken = shareTokenParam;
  const jobId = isPublic ? null : jobIdParam;

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('transcript'); // 'transcript' | 'summary' | 'quiz' | 'qna'
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  // Video Player state
  const videoRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [searchChunk, setSearchChunk] = useState('');

  // Quiz state: { [questionId]: selectedOptionKey }
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);

  // Chat Q&A state
  const chatStorageKey = jobId ? `cloudtutor_chat_${jobId}` : null;
  const [chatMessages, setChatMessages] = useState(() => {
    if (!chatStorageKey) return [];
    try {
      const stored = localStorage.getItem(chatStorageKey);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [inputQuestion, setInputQuestion] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [chatError, setChatError] = useState('');
  const chatMessagesEndRef = useRef(null);

  // Sync chat messages to localStorage per lecture
  useEffect(() => {
    if (chatStorageKey) {
      try {
        localStorage.setItem(chatStorageKey, JSON.stringify(chatMessages));
      } catch (e) {
        console.warn('Failed to save chat to localStorage:', e);
      }
    }
  }, [chatMessages, chatStorageKey]);

  // Auto-scroll chat to bottom
  const scrollToChatBottom = () => {
    chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (activeTab === 'qna') {
      scrollToChatBottom();
    }
  }, [chatMessages, activeTab, isAsking]);

  // Save to recent lecture whenever job data is successfully loaded
  useEffect(() => {
    if (job && (jobId || shareToken)) {
      const lectureInfo = {
        id: jobId || `share/${shareToken}`,
        title: job.original_filename || job.file_name || 'Bài giảng đang xem'
      };
      try {
        localStorage.setItem('cloudtutor_recent_lecture', JSON.stringify(lectureInfo));
        window.dispatchEvent(new CustomEvent('cloudtutor:recent_lecture_updated', { detail: lectureInfo }));
      } catch (e) {
        console.warn('Failed to save recent lecture:', e);
      }
    }
  }, [job, jobId, shareToken]);

  // Load detail function
  const loadDetail = async (showLoadingSpinner = false) => {
    if (showLoadingSpinner) setLoading(true);
    try {
      if (isPublic) {
        const data = await getPublicShareDetail(shareToken);
        setJob({
          ...data,
          status: 'COMPLETED',
          isPublicView: true
        });
      } else {
        const data = await getJobDetail(jobId, idToken);
        setJob(data);
      }
      setError('');
    } catch (err) {
      console.error('Failed to load detail:', err);
      if (isPublic) {
        setError(
          err.response?.status === 404 || err.message === 'NOT_FOUND'
            ? 'Liên kết chia sẻ bài giảng đã hết hạn hoặc không tồn tại.'
            : (err.response?.data?.error || err.message || 'Không thể tải bài giảng chia sẻ')
        );
      } else {
        setError(err.response?.data?.error || err.message || 'Không thể tải chi tiết bài giảng');
      }
    } finally {
      if (showLoadingSpinner) setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    loadDetail(true);
  }, [jobId, shareToken, isPublic]);

  // Smart Short Polling: Automatically poll every 3.5s if job is in active processing states (only in owner mode)
  useEffect(() => {
    if (isPublic || !job) return;
    const isTerminal = ['COMPLETED', 'COMPLETED_WITH_WARNING', 'FAILED', 'DELETED', 'DELETING'].includes(job.status);
    if (isTerminal) return;

    const interval = setInterval(() => {
      loadDetail(false);
    }, 3500);

    return () => clearInterval(interval);
  }, [isPublic, job?.status, jobId]);

  // Catch Video Player error (e.g. S3 presigned URL expired after 15 minutes) and renew seamlessly
  const handleVideoError = async () => {
    console.warn('Video URL may have expired or failed to stream. Fetching fresh presigned URL...');
    const savedTime = videoRef.current?.currentTime || 0;
    try {
      const updated = isPublic
        ? await getPublicShareDetail(shareToken)
        : await getJobDetail(jobId, idToken);

      setJob((prev) => ({ ...prev, ...updated }));
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

  // Seek video when clicking a transcript segment
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

  // Handle Q&A send message
  const handleSendQuestion = async (customQuestion = null) => {
    const qText = (typeof customQuestion === 'string' ? customQuestion : inputQuestion).trim();
    if (!qText || isAsking || !jobId) return;

    const userMsg = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      sender: 'user',
      text: qText,
      timestamp: new Date().toISOString()
    };

    setChatMessages((prev) => [...prev, userMsg]);
    setInputQuestion('');
    setIsAsking(true);
    setChatError('');

    try {
      const res = await askJobQuestion(jobId, qText, idToken);
      const aiMsg = {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        sender: 'ai',
        text: res.answer || 'Hệ thống đã phân tích bài giảng nhưng không tìm thấy thông tin phù hợp.',
        provider: res.provider || 'Gemini',
        status: res.status || 'SUCCESS',
        timestamp: new Date().toISOString()
      };
      setChatMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      console.error('Failed to ask question:', err);
      const errorMsg = err.response?.data?.error || err.message || 'Không thể kết nối đến máy chủ AI.';
      setChatError(errorMsg);
      const aiErrorMsg = {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        sender: 'ai',
        isError: true,
        text: `Đã có lỗi xảy ra: ${errorMsg}. Vui lòng thử lại.`,
        provider: 'Hệ thống',
        timestamp: new Date().toISOString()
      };
      setChatMessages((prev) => [...prev, aiErrorMsg]);
    } finally {
      setIsAsking(false);
    }
  };

  // Handle clearing chat history
  const handleClearChat = () => {
    if (window.confirm('Bạn có chắc muốn xóa toàn bộ lịch sử hỏi đáp của bài giảng này?')) {
      setChatMessages([]);
      setChatError('');
      if (chatStorageKey) {
        localStorage.removeItem(chatStorageKey);
      }
    }
  };

  // Handle Enter key for fast message sending
  const handleChatKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendQuestion();
    }
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 text-center">
        <RefreshCw className="w-10 h-10 animate-spin text-indigo-600 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-800">
          {isPublic ? 'Đang tải bài giảng được chia sẻ...' : 'Đang đồng bộ dữ liệu bài giảng từ AWS...'}
        </h2>
        <p className="text-sm text-slate-500 mt-2">
          {isPublic ? 'Đang truy vấn nội dung công khai từ CloudTutor API Gateway.' : 'Truy vấn trạng thái DynamoDB và kết quả học liệu S3.'}
        </p>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <AlertTriangle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-900">
          {isPublic ? 'Liên kết chia sẻ không khả dụng' : 'Không tìm thấy bài giảng'}
        </h2>
        <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
          {error || 'Bài giảng không tồn tại hoặc bạn không có quyền truy cập.'}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            to={idToken ? '/videos' : '/login'}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{idToken ? 'Quay lại Thư viện' : 'Về trang chủ / Đăng nhập'}</span>
          </Link>
        </div>
      </div>
    );
  }

  const isTerminal = ['COMPLETED', 'COMPLETED_WITH_WARNING', 'FAILED', 'DELETED', 'DELETING'].includes(job.status);
  const isProcessing = !isTerminal;
  const isCompleted = ['COMPLETED', 'COMPLETED_WITH_WARNING'].includes(job.status);
  const isFailed = job.status === 'FAILED';

  // 1. Resolve Transcript Items: Prefer granular segments from transcript, fallback to chunks.chunks or chunks
  const transcriptItems = (() => {
    if (Array.isArray(job.transcript?.segments) && job.transcript.segments.length > 0) {
      return job.transcript.segments;
    }
    if (Array.isArray(job.chunks?.chunks) && job.chunks.chunks.length > 0) {
      return job.chunks.chunks;
    }
    if (Array.isArray(job.chunks) && job.chunks.length > 0) {
      return job.chunks;
    }
    return [];
  })();

  // Filtered transcript based on user search
  const filteredTranscript = (() => {
    if (!searchChunk.trim()) return transcriptItems;
    const q = searchChunk.toLowerCase();
    return transcriptItems.filter((item) => (item.text || '').toLowerCase().includes(q));
  })();

  // 2. Resolve Summary: Parse raw string into sentences for Key Points, or support legacy object
  const summaryData = (() => {
    if (!job.summary) return null;
    if (typeof job.summary === 'string') {
      const raw = job.summary.trim();
      const sentences = raw
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 8);

      return {
        isString: true,
        title: 'Tóm Tắt Cốt Lõi Bài Giảng',
        overview: raw,
        key_points: sentences.length > 1 ? sentences : [raw],
        recommendations: null
      };
    }
    return {
      isString: false,
      title: job.summary.title || 'Tóm Tắt Tổng Quan',
      overview: job.summary.overview || '',
      key_points: Array.isArray(job.summary.key_points) ? job.summary.key_points : [],
      recommendations: job.summary.recommendations || ''
    };
  })();

  // 3. Resolve Quiz Questions List
  const quizQuestions = (() => {
    if (!job.quiz) return [];
    if (Array.isArray(job.quiz.question)) return job.quiz.question;
    if (Array.isArray(job.quiz.questions)) return job.quiz.questions;
    if (Array.isArray(job.quiz)) return job.quiz;
    return [];
  })();

  // 4. Resolve Quiz Answers List (from quiz.answer, quiz.answers, job.answers, etc.)
  const quizAnswersList = (() => {
    if (!job.quiz && !job.answers && !job.quiz_answers) return [];
    if (Array.isArray(job.quiz?.answer)) return job.quiz.answer;
    if (Array.isArray(job.quiz?.answers)) return job.quiz.answers;
    if (Array.isArray(job.answers)) return job.answers;
    if (Array.isArray(job.quiz_answers)) return job.quiz_answers;
    return [];
  })();

  // Build Answer Map for fast O(1) lookup
  const answerMap = (() => {
    const map = {};
    quizAnswersList.forEach((ans) => {
      const qId = ans.question_id ?? ans.id;
      if (qId !== undefined && qId !== null) {
        map[String(qId)] = {
          correct_answer: (ans.correct_answer || '').trim().toUpperCase(),
          explanation: ans.explaination || ans.explanation || ''
        };
      }
    });
    return map;
  })();

  // Difficulty badge helper
  const getDifficultyBadge = (difficulty) => {
    if (!difficulty) return null;
    const diff = String(difficulty).toLowerCase();
    if (diff === 'easy') {
      return (
        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
          Dễ (Easy)
        </span>
      );
    }
    if (diff === 'medium') {
      return (
        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
          Trung bình (Medium)
        </span>
      );
    }
    if (diff === 'hard') {
      return (
        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
          Khó (Hard)
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
        {difficulty}
      </span>
    );
  };

  // Helper to extract question options: supports { "A": "...", ... } and array format
  const getQuestionOptions = (q) => {
    if (q.option && typeof q.option === 'object' && !Array.isArray(q.option)) {
      return Object.entries(q.option).map(([key, text]) => ({
        key: key.trim().toUpperCase(),
        text: String(text)
      }));
    }
    if (q.options && typeof q.options === 'object' && !Array.isArray(q.options)) {
      return Object.entries(q.options).map(([key, text]) => ({
        key: key.trim().toUpperCase(),
        text: String(text)
      }));
    }
    if (Array.isArray(q.options)) {
      return q.options.map((text, idx) => ({
        key: String.fromCharCode(65 + idx),
        text: String(text)
      }));
    }
    if (Array.isArray(q.option)) {
      return q.option.map((text, idx) => ({
        key: String.fromCharCode(65 + idx),
        text: String(text)
      }));
    }
    return [];
  };

  // Option selection handler
  const handleSelectOption = (qIdentifier, optionKey) => {
    if (quizSubmitted) return;
    setQuizAnswers((prev) => ({
      ...prev,
      [qIdentifier]: optionKey
    }));
  };

  // Calculate scores
  const totalQuestions = quizQuestions.length;
  const answeredCount = Object.keys(quizAnswers).length;
  const correctCount = (() => {
    if (!quizSubmitted) return 0;
    let count = 0;
    quizQuestions.forEach((q, idx) => {
      const qId = String(q.id ?? idx + 1);
      const selected = quizAnswers[qId];
      const ansInfo = answerMap[qId];
      if (ansInfo && selected && selected.toUpperCase() === ansInfo.correct_answer) {
        count++;
      }
    });
    return count;
  })();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Navigation & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Link
            to={idToken ? '/videos' : '/login'}
            className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors"
            title={idToken ? 'Quay lại Thư viện bài giảng' : 'Về trang Đăng nhập'}
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
                {job.original_filename || job.file_name || 'Chi tiết bài giảng'}
              </h1>

              {/* Public Badge */}
              {isPublic && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                  <Share2 className="w-3 h-3 text-indigo-600" />
                  Bài giảng chia sẻ công khai
                </span>
              )}

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
              {job.created_at && (
                <span>{new Date(job.created_at).toLocaleString('vi-VN')}</span>
              )}
              {isPublic && (
                <span className="text-slate-400">· Chế độ xem khách (Không cần tài khoản)</span>
              )}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {!isPublic && isCompleted && (
            <button
              type="button"
              onClick={() => setIsShareModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 text-xs font-bold shadow-sm transition-colors"
              title="Tạo liên kết chia sẻ công khai (7 ngày)"
            >
              <Share2 className="w-3.5 h-3.5 text-indigo-600" />
              <span>Chia sẻ bài giảng</span>
            </button>
          )}

          <button
            onClick={() => loadDetail(false)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 text-xs font-semibold shadow-sm transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isProcessing && !isPublic ? 'animate-spin text-indigo-600' : ''}`} />
            <span>Làm mới</span>
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

      {/* Status Banner: In-Progress (Only for owner mode) */}
      {!isPublic && isProcessing && (
        <div className="mb-6 p-4 sm:p-5 bg-indigo-50/80 rounded-2xl border border-indigo-200/80 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
              <RefreshCw className="w-5 h-5 animate-spin" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                Hệ thống đang xử lý bài giảng của bạn
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Trang này tự động cập nhật trạng thái. Toàn bộ học liệu sẽ xuất hiện khi xử lý xong.
              </p>
            </div>
          </div>
          <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-indigo-100 text-indigo-700 border border-indigo-200 shrink-0 ml-3">
            {job.status}
          </span>
        </div>
      )}

      {/* Status Banner: Completed (Only in owner mode) */}
      {!isPublic && isCompleted && (
        <div className="mb-6 p-4 sm:p-5 bg-emerald-50/80 rounded-2xl border border-emerald-200/80 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                Hệ thống đã xử lý thành công
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Toàn bộ dữ liệu học liệu (Video, Transcript, Summary, Quiz, Hỏi đáp AI) đã sẵn sàng.
              </p>
            </div>
          </div>
          <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0 ml-3">
            {job.status}
          </span>
        </div>
      )}

      {/* Status Banner: Failed */}
      {!isPublic && isFailed && (
        <div className="mb-6 p-4 sm:p-5 bg-rose-50 rounded-2xl border border-rose-200 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-rose-900">
                Có vấn đề khi đang xử lý bài giảng
              </h3>
              <p className="text-xs text-rose-700 mt-0.5 font-mono">
                {job.error_message || job.error_code || 'Không thể hoàn tất toàn bộ quy trình xử lý học liệu.'}
              </p>
            </div>
          </div>
          <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-rose-100 text-rose-700 border border-rose-200 shrink-0 ml-3">
            {job.status || 'FAILED'}
          </span>
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
              <span>Đồng bộ mốc thời gian bài giảng</span>
            </div>
          </div>
        </div>

        {/* Right Column: Multi-tab Study Hub (Transcript, Summary, Quiz, QnA) */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[650px] overflow-hidden">
          {/* Tabs Navigation */}
          <div className="flex items-center border-b border-slate-200 bg-slate-50/70 p-1.5 gap-1 overflow-x-auto">
            <button
              onClick={() => setActiveTab('transcript')}
              className={`flex-1 py-2 px-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0 ${
                activeTab === 'transcript'
                  ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>Transcript</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {transcriptItems.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('summary')}
              className={`flex-1 py-2 px-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0 ${
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
              className={`flex-1 py-2 px-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0 ${
                activeTab === 'quiz'
                  ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <HelpCircle className="w-4 h-4" />
              <span>Trắc nghiệm</span>
              {quizQuestions.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  {quizQuestions.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('qna')}
              className={`flex-1 py-2 px-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0 ${
                activeTab === 'qna'
                  ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span>Hỏi đáp AI</span>
              {chatMessages.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-bold">
                  {chatMessages.length}
                </span>
              )}
            </button>
          </div>

          {/* Tab 1: Interactive Transcript Chunks / Segments */}
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

              {/* Items List */}
              <div className="flex-1 overflow-y-auto pr-1 space-y-2.5">
                {filteredTranscript.length === 0 ? (
                  <div className="text-center py-12 text-slate-400 text-xs">
                    {transcriptItems.length === 0
                      ? isProcessing && !isPublic
                        ? 'Đang trích xuất nội dung... Dữ liệu sẽ hiển thị ngay khi hoàn tất.'
                        : 'Không có dữ liệu transcript cho bài giảng này.'
                      : 'Không tìm thấy đoạn nội dung phù hợp với từ khóa.'}
                  </div>
                ) : (
                  filteredTranscript.map((item, idx) => {
                    const startTime = typeof item.start_time === 'number' ? item.start_time : 0;
                    const endTime = typeof item.end_time === 'number' ? item.end_time : startTime + 5;
                    const isActive = currentTime >= startTime && currentTime <= endTime;

                    return (
                      <div
                        key={item.chunk_id || `seg-${idx}`}
                        onClick={() => handleSeek(startTime)}
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
                            {formatTime(startTime)} - {formatTime(endTime)}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {item.source || job.content_source || 'ASR'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-800 leading-relaxed whitespace-pre-line">
                          {item.text}
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
              {!summaryData ? (
                <div className="text-center py-16 text-slate-400 text-xs">
                  {isProcessing && !isPublic
                    ? 'Amazon Bedrock đang phân tích nội dung và sinh tóm tắt bài giảng...'
                    : 'Chưa có bản tóm tắt cho bài giảng này.'}
                </div>
              ) : (
                <div className="space-y-4 text-xs text-slate-700 leading-relaxed">
                  {/* Overview Card */}
                  <div className="p-4 rounded-xl bg-indigo-50/60 border border-indigo-100">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="w-4 h-4 text-indigo-600" />
                      <h3 className="font-extrabold text-sm text-indigo-950">
                        {summaryData.title}
                      </h3>
                    </div>
                    <p className="text-slate-700 text-xs leading-relaxed">{summaryData.overview}</p>
                  </div>

                  {/* Key Points */}
                  {summaryData.key_points && summaryData.key_points.length > 0 && (
                    <div>
                      <h4 className="font-bold text-slate-900 mb-2.5 flex items-center gap-1.5 text-xs">
                        <Check className="w-4 h-4 text-emerald-600" />
                        Các luận điểm cốt lõi của bài giảng (Key Points)
                      </h4>
                      <ul className="space-y-2">
                        {summaryData.key_points.map((pt, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2.5 bg-slate-50 hover:bg-slate-100/80 p-3 rounded-xl border border-slate-200/80 transition-colors"
                          >
                            <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                              {i + 1}
                            </span>
                            <span className="text-slate-800 text-xs leading-relaxed">{pt}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {summaryData.recommendations && (
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                      <span className="font-bold text-slate-800 block mb-1">💡 Lưu ý quan trọng:</span>
                      <p className="text-slate-600 text-[11px]">{summaryData.recommendations}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Interactive Quiz (Test Mode) */}
          {activeTab === 'quiz' && (
            <div className="flex-1 p-5 overflow-y-auto flex flex-col justify-between">
              {quizQuestions.length === 0 ? (
                <div className="text-center py-16 text-slate-400 text-xs">
                  {isProcessing && !isPublic
                    ? 'Bedrock AI đang biên soạn bộ câu hỏi trắc nghiệm ôn tập...'
                    : 'Chưa có bộ câu hỏi trắc nghiệm cho bài giảng này.'}
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Mode Banner */}
                  <div className="px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-[11px] text-slate-600">
                    <div className="flex items-center gap-1.5">
                      <HelpCircle className="w-3.5 h-3.5 text-indigo-600" />
                      <span className="font-semibold text-slate-800">Chế độ thi thử (Test Mode)</span>
                    </div>
                    <span>{quizSubmitted ? 'Đã hoàn thành kiểm tra' : `Đã chọn: ${answeredCount}/${totalQuestions}`}</span>
                  </div>

                  {quizQuestions.map((q, qIndex) => {
                    const qId = String(q.id ?? qIndex + 1);
                    const selectedOptionKey = quizAnswers[qId];
                    const ansInfo = answerMap[qId];
                    const hasAnswerKey = Boolean(ansInfo?.correct_answer);
                    const optionsList = getQuestionOptions(q);

                    return (
                      <div key={q.id || qIndex} className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
                        {/* Header: Question Number, Difficulty, and Content */}
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <h4 className="font-bold text-xs text-slate-900 flex items-start gap-2 flex-1">
                            <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-mono text-[11px] shrink-0">
                              Câu {qIndex + 1}
                            </span>
                            <span className="leading-relaxed">{q.question}</span>
                          </h4>
                          {getDifficultyBadge(q.difficulty)}
                        </div>

                        {/* Options */}
                        <div className="space-y-2">
                          {optionsList.map((opt) => {
                            let optionClass = 'border-slate-200 bg-slate-50/50 hover:bg-slate-100 text-slate-800';

                            if (quizSubmitted) {
                              if (hasAnswerKey) {
                                if (opt.key === ansInfo.correct_answer) {
                                  optionClass = 'border-emerald-500 bg-emerald-50 text-emerald-900 font-semibold ring-1 ring-emerald-400';
                                } else if (selectedOptionKey === opt.key && selectedOptionKey !== ansInfo.correct_answer) {
                                  optionClass = 'border-rose-400 bg-rose-50 text-rose-900 font-medium';
                                } else {
                                  optionClass = 'border-slate-200 bg-slate-50/30 text-slate-400 opacity-70';
                                }
                              } else {
                                if (selectedOptionKey === opt.key) {
                                  optionClass = 'border-indigo-500 bg-indigo-50 text-indigo-900 font-semibold';
                                } else {
                                  optionClass = 'border-slate-200 bg-slate-50/30 text-slate-400';
                                }
                              }
                            } else {
                              if (selectedOptionKey === opt.key) {
                                optionClass = 'border-indigo-600 bg-indigo-50/90 text-indigo-950 font-bold ring-2 ring-indigo-500/20';
                              }
                            }

                            return (
                              <button
                                key={opt.key}
                                type="button"
                                disabled={quizSubmitted}
                                onClick={() => handleSelectOption(qId, opt.key)}
                                className={`w-full text-left p-2.5 rounded-xl border text-xs transition-all flex items-start gap-2.5 ${optionClass}`}
                              >
                                <span
                                  className={`w-5 h-5 rounded-lg flex items-center justify-center font-mono font-bold text-[11px] shrink-0 transition-colors ${
                                    selectedOptionKey === opt.key
                                      ? 'bg-indigo-600 text-white'
                                      : 'bg-white border border-slate-300 text-slate-600'
                                  }`}
                                >
                                  {opt.key}
                                </span>
                                <span className="flex-1 mt-0.5 leading-relaxed">{opt.text}</span>
                              </button>
                            );
                          })}
                        </div>

                        {/* Explanation & Feedback (Shown after submit) */}
                        {quizSubmitted && ansInfo && (
                          <div className="mt-3 pt-3 border-t border-slate-100 text-xs">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              {selectedOptionKey === ansInfo.correct_answer ? (
                                <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                  Chính xác! Đáp án đúng: {ansInfo.correct_answer}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-rose-700 font-bold">
                                  <XCircle className="w-4 h-4 text-rose-600" />
                                  Chưa chính xác. Đáp án đúng là {ansInfo.correct_answer}
                                </span>
                              )}
                            </div>
                            {ansInfo.explanation && (
                              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 text-[11px] leading-relaxed">
                                <strong className="font-semibold text-slate-900 block mb-0.5">
                                  Giải thích chi tiết:
                                </strong>
                                {ansInfo.explanation}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Submit / Reset Actions */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                    {quizSubmitted ? (
                      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 w-full bg-slate-50 p-3 rounded-xl border border-slate-200">
                        <div>
                          <span className="text-xs font-bold text-slate-800">
                            Kết quả kiểm tra:{' '}
                            <span className={correctCount === totalQuestions ? 'text-emerald-600' : 'text-indigo-600'}>
                              {correctCount} / {totalQuestions} câu đúng
                            </span>
                          </span>
                          {correctCount === totalQuestions && (
                            <span className="ml-2 text-[11px] text-emerald-600 font-semibold">🎉 Xuất sắc!</span>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            setQuizAnswers({});
                            setQuizSubmitted(false);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold shadow-sm transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Làm lại Quiz</span>
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2 w-full">
                        <button
                          onClick={() => setQuizSubmitted(true)}
                          disabled={answeredCount < totalQuestions}
                          className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs shadow-md shadow-indigo-200 transition-all text-center flex items-center justify-center gap-2"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>
                            {answeredCount < totalQuestions
                              ? `Hãy chọn đáp án cho tất cả các câu (${answeredCount}/${totalQuestions})`
                              : 'Nộp bài & Kiểm tra đáp án'}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 4: Interactive Q&A with AI */}
          {activeTab === 'qna' && (
            <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50/40">
              {/* Check if user is in public share view */}
              {isPublic ? (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center mb-3 shadow-inner">
                    <MessageSquare className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 mb-1">
                    Hỏi đáp AI với bài giảng
                  </h3>
                  <p className="text-xs text-slate-500 max-w-xs mb-5 leading-relaxed">
                    Tính năng trợ lý thông minh đặt câu hỏi cho AI chỉ khả dụng khi bạn đăng nhập tài khoản CloudTutor.
                  </p>
                  <Link
                    to="/login"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md shadow-indigo-200 transition-colors"
                  >
                    <span>Đăng nhập ngay</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                </div>
              ) : (
                <>
                  {/* Top Bar inside Q&A tab */}
                  <div className="px-4 py-2.5 bg-white border-b border-slate-100 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="font-semibold text-slate-800">
                        Trợ lý học tập AI
                      </span>
                    </div>

                    {chatMessages.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearChat}
                        className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-rose-600 transition-colors p-1 rounded-lg hover:bg-slate-100"
                        title="Xóa toàn bộ lịch sử hỏi đáp"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Xóa lịch sử</span>
                      </button>
                    )}
                  </div>

                  {/* Messages Area */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
                    {/* Welcome & Suggestions if empty */}
                    {chatMessages.length === 0 ? (
                      <div className="h-full flex flex-col justify-center items-center text-center p-4">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-violet-500 text-white flex items-center justify-center mb-3 shadow-md shadow-indigo-100">
                          <Bot className="w-6 h-6" />
                        </div>
                        <h4 className="text-sm font-bold text-slate-900 mb-1">
                          Bạn có thắc mắc gì về bài giảng này?
                        </h4>
                        <p className="text-xs text-slate-500 max-w-xs mb-5 leading-relaxed">
                          Hệ thống AI sẽ phân tích toàn bộ video, transcript và cung cấp câu trả lời giải thích chi tiết cho bạn.
                        </p>

                        {/* Quick Prompts */}
                        <div className="w-full space-y-2 max-w-sm text-left">
                          <span className="text-[11px] font-semibold text-slate-400 block px-1">
                            Gợi ý câu hỏi nhanh:
                          </span>
                          <button
                            type="button"
                            onClick={() => handleSendQuestion('Video này nói về nội dung gì?')}
                            className="w-full text-left p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-indigo-50 hover:border-indigo-200 text-xs text-slate-700 transition-all flex items-center gap-2 shadow-xs group"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0 group-hover:scale-110 transition-transform" />
                            <span>Video này nói về nội dung gì?</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleSendQuestion('Tóm tắt 3 ý quan trọng nhất trong bài giảng')}
                            className="w-full text-left p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-indigo-50 hover:border-indigo-200 text-xs text-slate-700 transition-all flex items-center gap-2 shadow-xs group"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0 group-hover:scale-110 transition-transform" />
                            <span>Tóm tắt 3 ý quan trọng nhất trong bài giảng</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleSendQuestion('Giải thích các khái niệm cốt lõi trong video')}
                            className="w-full text-left p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-indigo-50 hover:border-indigo-200 text-xs text-slate-700 transition-all flex items-center gap-2 shadow-xs group"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0 group-hover:scale-110 transition-transform" />
                            <span>Giải thích các khái niệm cốt lõi trong video</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {chatMessages.map((msg) => {
                          const isUser = msg.sender === 'user';
                          const timeStr = msg.timestamp
                            ? new Date(msg.timestamp).toLocaleTimeString('vi-VN', {
                                hour: '2-digit',
                                minute: '2-digit'
                              })
                            : '';

                          return (
                            <div
                              key={msg.id}
                              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} animate-in fade-in duration-200`}
                            >
                              <div
                                className={`max-w-[92%] rounded-2xl p-3.5 text-xs shadow-xs leading-relaxed transition-all ${
                                  isUser
                                    ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-tr-xs shadow-sm shadow-indigo-100'
                                    : msg.isError
                                    ? 'bg-rose-50 text-rose-900 border border-rose-200 rounded-tl-xs'
                                    : 'bg-white text-slate-800 border border-slate-200/90 rounded-tl-xs shadow-xs'
                                }`}
                              >
                                {!isUser && (
                                  <div className="flex items-center justify-between gap-1.5 mb-2.5 pb-2 border-b border-slate-100">
                                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-700">
                                      <span className="w-5 h-5 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
                                        <Sparkles className="w-3 h-3" />
                                      </span>
                                      <span>{msg.provider || 'Gemini'} AI</span>
                                    </div>
                                    <span className="text-[10px] text-slate-400 font-mono">{timeStr}</span>
                                  </div>
                                )}

                                {isUser || msg.isError ? (
                                  <div className="whitespace-pre-line leading-relaxed">{msg.text}</div>
                                ) : (
                                  <FormattedAiMessage text={msg.text} onSeek={handleSeek} />
                                )}
                              </div>

                              {isUser && (
                                <span className="text-[10px] text-slate-400 mt-1 px-1 font-mono">
                                  {timeStr}
                                </span>
                              )}
                            </div>
                          );
                        })}

                        {/* Thinking / Asking Bubble */}
                        {isAsking && (
                          <div className="flex flex-col items-start animate-in fade-in duration-150">
                            <div className="max-w-[85%] bg-white border border-slate-200 rounded-2xl rounded-tl-xs p-3 text-xs text-slate-600 shadow-xs flex items-center gap-2.5">
                              <Loader2 className="w-4 h-4 animate-spin text-indigo-600 shrink-0" />
                              <span className="text-slate-600">
                                Trợ lý đang suy nghĩ và phân tích bài giảng...
                              </span>
                            </div>
                          </div>
                        )}

                        <div ref={chatMessagesEndRef} />
                      </>
                    )}
                  </div>

                  {/* Bottom Input Box */}
                  <div className="p-3 bg-white border-t border-slate-200">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleSendQuestion();
                      }}
                      className="flex items-end gap-2"
                    >
                      <div className="flex-1 relative">
                        <textarea
                          rows={2}
                          value={inputQuestion}
                          onChange={(e) => setInputQuestion(e.target.value)}
                          onKeyDown={handleChatKeyDown}
                          placeholder="Hỏi AI về nội dung bài giảng (Enter để gửi, Shift+Enter xuống dòng)..."
                          disabled={isAsking}
                          className="w-full resize-none p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-800 disabled:opacity-60"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={!inputQuestion.trim() || isAsking}
                        className="h-[52px] px-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white rounded-xl shadow-sm transition-all flex items-center justify-center shrink-0 cursor-pointer disabled:cursor-not-allowed"
                        title="Gửi câu hỏi (Enter)"
                      >
                        {isAsking ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                      </button>
                    </form>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Share Modal Dialog */}
      {!isPublic && jobId && (
        <ShareModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          jobId={jobId}
          jobTitle={job.original_filename || job.file_name}
          token={idToken}
        />
      )}
    </div>
  );
}

export default VideoDetailPage;
