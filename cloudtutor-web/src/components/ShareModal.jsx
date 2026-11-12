import React, { useState, useEffect } from 'react';
import { createShareLink } from '../api/jobs';
import {
  Share2,
  Copy,
  Check,
  Clock,
  Shield,
  X,
  ExternalLink,
  RefreshCw,
  AlertCircle
} from 'lucide-react';

export function ShareModal({ isOpen, onClose, jobId, jobTitle, token }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shareData, setShareData] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen && jobId) {
      loadShareLink();
    } else {
      setShareData(null);
      setError('');
      setCopied(false);
    }
  }, [isOpen, jobId]);

  const loadShareLink = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await createShareLink(jobId, token);
      setShareData(data);
    } catch (err) {
      console.error('Failed to create share link:', err);
      setError(err.response?.data?.error || err.message || 'Không thể tạo liên kết chia sẻ');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const shareUrl = shareData?.share_token
    ? `${window.location.origin}/share/${shareData.share_token}`
    : '';

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const input = document.createElement('input');
        input.value = shareUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="bg-white w-full max-w-lg rounded-2xl border border-slate-200 shadow-2xl overflow-hidden transform transition-all scale-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shadow-inner">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">Chia sẻ bài giảng</h3>
              <p className="text-xs text-slate-500">Bất kỳ ai có liên kết đều có thể truy cập</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5">
          {/* Lecture name */}
          <div>
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
              Bài giảng chia sẻ
            </span>
            <p className="text-sm font-bold text-slate-800 line-clamp-2 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
              {jobTitle || 'Bài giảng CloudTutor'}
            </p>
          </div>

          {/* Loading State */}
          {loading && (
            <div className="py-8 text-center text-slate-500 text-xs flex flex-col items-center gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-indigo-600" />
              <span>Đang tạo liên kết chia sẻ bảo mật (POST /jobs/:id/share)...</span>
            </div>
          )}

          {/* Error State */}
          {!loading && error && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold mb-1">Không thể khởi tạo liên kết</p>
                <p>{error}</p>
                <button
                  onClick={loadShareLink}
                  className="mt-2 text-indigo-600 font-semibold hover:underline flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Thử lại</span>
                </button>
              </div>
            </div>
          )}

          {/* Success State: Link & Copy */}
          {!loading && shareData && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1.5">
                  Đường dẫn công khai:
                </label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      readOnly
                      value={shareUrl}
                      onClick={(e) => e.target.select()}
                      className="w-full pr-10 pl-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all select-all"
                    />
                  </div>
                  <button
                    onClick={handleCopy}
                    className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                      copied
                        ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200'
                        : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200'
                    }`}
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Đã chép</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Sao chép</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Expiration and info details */}
              <div className="p-3.5 bg-slate-50/80 rounded-xl border border-slate-200/80 space-y-2 text-xs text-slate-600">
                <div className="flex items-center gap-2 text-slate-700 font-medium">
                  <Clock className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span>
                    Hiệu lực đến:{' '}
                    <strong className="text-slate-900 font-bold">
                      {shareData.expires_at ? new Date(shareData.expires_at).toLocaleString('vi-VN') : '7 ngày'}
                    </strong>
                  </span>
                </div>
                <div className="flex items-center gap-2 text-slate-500 text-[11px]">
                  <Shield className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Người nhận có thể xem video, transcript, tóm tắt và làm bài quiz không cần đăng nhập.</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-50 border-t border-slate-100">
          {shareUrl ? (
            <a
              href={shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
            >
              <span>Xem thử bài giảng chia sẻ</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          ) : (
            <div />
          )}

          <button
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold shadow-sm transition-colors"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
export default ShareModal;
