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
  Layers
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
      setJobs(data);
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
  }, []);

  const handleDelete = async (jobId) => {
    if (!window.confirm('Bạn có chắc muốn xóa job này khỏi hệ thống?')) return;
    setDeletingId(jobId);
    try {
      await deleteJob(jobId, idToken);
      setJobs((prev) => prev.filter((j) => j.job_id !== jobId));
    } catch (err) {
      alert('Không thể xóa job: ' + err.message);
    } finally {
      setDeletingId(null);
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return 'N/A';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'UPLOADED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle className="w-3 h-3 text-emerald-600" />
            UPLOADED (Đã lên S3)
          </span>
        );
      case 'CREATED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <Clock className="w-3 h-3 text-amber-600" />
            CREATED (Chờ upload)
          </span>
        );
      case 'PROCESSING_AI':
      case 'PROCESSING_TRANSCRIBE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <RefreshCw className="w-3 h-3 animate-spin text-indigo-600" />
            Đang xử lý Cloud
          </span>
        );
      case 'COMPLETED_WITH_WARNING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            <AlertCircle className="w-3 h-3 text-amber-600" />
            Hoàn thành có cảnh báo
          </span>
        );
      case 'COMPLETED':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <FileCheck className="w-3 h-3 text-indigo-600" />
            COMPLETED (Đầy đủ)
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
            Danh sách các bài giảng đã upload và quản lý trạng thái xử lý đa phương tiện.
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
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-indigo-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Đang đồng bộ dữ liệu Job từ DynamoDB...</p>
        </div>
      ) : jobs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center">
          <Video className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-800">Chưa có bài giảng nào</h3>
          <p className="text-xs text-slate-500 mt-1 mb-5">
            Hãy tải lên video đầu tiên để bắt đầu quy trình tạo Job trên CloudTutor.
          </p>
          <Link
            to="/upload"
            className="inline-flex items-center space-x-1.5 px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Tải lên ngay</span>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {jobs.map((job) => (
            <div
              key={job.job_id}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col justify-between"
            >
              <div>
                {/* Status + Date */}
                <div className="flex items-center justify-between gap-2 mb-3">
                  {getStatusBadge(job.status)}
                  <span className="text-[11px] text-slate-400 font-mono">
                    {new Date(job.created_at).toLocaleDateString('vi-VN')}
                  </span>
                </div>

                {/* Job Title / File Name */}
                <h3 className="font-bold text-slate-800 text-sm line-clamp-2 hover:text-indigo-600 transition-colors">
                  {job.file_name}
                </h3>

                {/* Meta details */}
                <div className="mt-3 py-2 border-y border-slate-100 flex items-center justify-between text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <HardDrive className="w-3.5 h-3.5 text-slate-400" />
                    {formatFileSize(job.file_size)}
                  </span>
                  <span className="flex items-center gap-1 font-mono text-[11px]">
                    <Layers className="w-3.5 h-3.5 text-slate-400" />
                    ID: {job.job_id.substring(0, 10)}...
                  </span>
                </div>

                {/* Summary / Stage Preview */}
                <p className="mt-3 text-xs text-slate-600 line-clamp-3 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  {job.summary_preview || 'Đã ghi nhận trên hệ thống S3.'}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[11px] text-slate-400 font-mono truncate max-w-[180px]">
                  {job.s3_key || 's3://cloudtutor/...'}
                </span>
                <button
                  onClick={() => handleDelete(job.job_id)}
                  disabled={deletingId === job.job_id}
                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                  title="Xóa job"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
