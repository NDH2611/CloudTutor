import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchJobs, deleteJob } from '../api/jobs';
import {
  Video,
  Clock,
  HardDrive,
  Trash2,
  ExternalLink,
  Plus,
  RefreshCw,
  AlertCircle,
  FileCheck,
  CheckCircle,
  Layers,
  PlayCircle,
  Cpu
} from 'lucide-react';

export function VideosPage() {
  const { idToken } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);

  const loadJobs = async () => {
    setLoading(true);
    try {
      const data = await fetchJobs(idToken);
      const items = data.items || (Array.isArray(data) ? data : []);
      setJobs(items);
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
  }, []);

  const handleDelete = async (e, jobId) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm('Bạn có chắc muốn xóa job này khỏi hệ thống? Hành động này sẽ dọn dẹp toàn bộ dữ liệu trên S3 và DynamoDB.')) return;
    setDeletingId(jobId);
    try {
      await deleteJob(jobId, idToken);
      setJobs((prev) => prev.filter((j) => j.job_id !== jobId));
    } catch (err) {
      alert('Không thể xóa job: ' + (err.response?.data?.error || err.message));
    } finally {
      setDeletingId(null);
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return null;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'UPLOADED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
            Đã tải lên S3
          </span>
        );
      case 'CREATED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            Chờ upload (CREATED)
          </span>
        );
      case 'QUEUED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-50 text-sky-700 border border-sky-200">
            <Layers className="w-3.5 h-3.5 text-sky-600" />
            Trong hàng đợi (QUEUED)
          </span>
        );
      case 'TRANSCRIBING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
            Đang bóc băng (ASR)
          </span>
        );
      case 'PROCESSING_OCR':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
            <Cpu className="w-3.5 h-3.5 animate-pulse text-purple-600" />
            Trích xuất chữ (OCR Fallback)
          </span>
        );
      case 'PROCESSING_AI':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />
            Bedrock AI đang phân tích
          </span>
        );
      case 'COMPLETED_WITH_WARNING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
            Hoàn tất có cảnh báo
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
            Xử lý thất bại (FAILED)
          </span>
        );
      case 'COMPLETED':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <FileCheck className="w-3.5 h-3.5 text-emerald-600" />
            Hoàn thành (COMPLETED)
          </span>
        );
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Thư viện bài giảng (My Videos)
          </h1>
          <p className="text-slate-500 mt-1 text-sm">
            Danh sách bài giảng CloudTutor từ AWS DynamoDB & S3 Pipeline.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={loadJobs}
            className="p-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            title="Làm mới danh sách"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <Link
            to="/upload"
            className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-md shadow-indigo-200 transition-all flex items-center space-x-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Tải lên video mới</span>
          </Link>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm">
          <RefreshCw className="w-8 h-8 animate-spin text-indigo-600 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-600">Đang truy vấn bảng DynamoDB (GSI owner-created-at-index)...</p>
        </div>
      ) : jobs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center">
          <Video className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-800">Chưa có bài giảng nào</h3>
          <p className="text-xs text-slate-500 mt-1 mb-5">
            Hãy tải lên video đầu tiên để kích hoạt quy trình xử lý đa phương tiện trên AWS.
          </p>
          <Link
            to="/upload"
            className="inline-flex items-center space-x-1.5 px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg shadow-sm hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Tải lên ngay</span>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {jobs.map((job) => {
            const fileName = job.original_filename || job.file_name || 'Bài giảng không tên';
            const isProcessing = ['CREATED', 'QUEUED', 'TRANSCRIBING', 'PROCESSING_OCR', 'PROCESSING_AI'].includes(job.status);
            const isReady = ['COMPLETED', 'COMPLETED_WITH_WARNING'].includes(job.status);

            return (
              <div
                key={job.job_id}
                className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all p-5 flex flex-col justify-between group"
              >
                <div>
                  {/* Status Badge + Creation Date */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    {getStatusBadge(job.status)}
                    <span className="text-[11px] text-slate-400 font-mono">
                      {job.created_at ? new Date(job.created_at).toLocaleDateString('vi-VN') : ''}
                    </span>
                  </div>

                  {/* Job Title / File Name */}
                  <Link
                    to={`/videos/${job.job_id}`}
                    className="font-bold text-slate-800 text-sm line-clamp-2 hover:text-indigo-600 transition-colors block"
                  >
                    {fileName}
                  </Link>

                  {/* Meta details */}
                  <div className="mt-3 py-2 border-y border-slate-100 flex items-center justify-between text-xs text-slate-500">
                    <span className="flex items-center gap-1 font-mono text-[11px] text-slate-500">
                      <Layers className="w-3.5 h-3.5 text-slate-400" />
                      {job.job_id.substring(0, 16)}...
                    </span>
                    {formatFileSize(job.file_size) && (
                      <span className="flex items-center gap-1">
                        <HardDrive className="w-3.5 h-3.5 text-slate-400" />
                        {formatFileSize(job.file_size)}
                      </span>
                    )}
                  </div>

                  {/* Preview or Progress Hint */}
                  <div className="mt-3 text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    {isProcessing ? (
                      <div className="flex items-center gap-2 text-indigo-700">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Hệ thống đang xử lý, click để xem tiến trình thời gian thực.</span>
                      </div>
                    ) : (
                      <p className="line-clamp-2 text-slate-600">
                        {job.summary_preview || 'Bài giảng đã được phân tích. Nhấn vào bên dưới để mở học liệu đầy đủ.'}
                      </p>
                    )}
                  </div>
                </div>

                {/* Bottom Actions */}
                <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <Link
                    to={`/videos/${job.job_id}`}
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                      isReady
                        ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                        : isProcessing
                        ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {isReady ? (
                      <>
                        <PlayCircle className="w-3.5 h-3.5" />
                        <span>Vào học bài</span>
                      </>
                    ) : isProcessing ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Theo dõi tiến trình</span>
                      </>
                    ) : (
                      <>
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Xem chi tiết</span>
                      </>
                    )}
                  </Link>

                  <button
                    onClick={(e) => handleDelete(e, job.job_id)}
                    disabled={deletingId === job.job_id}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                    title="Xóa bài giảng và dữ liệu S3"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
