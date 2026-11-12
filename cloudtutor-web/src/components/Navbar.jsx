import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Cloud, UploadCloud, Video, LogOut, User, CheckCircle2, Shield, PlayCircle } from 'lucide-react';

const RECENT_LECTURE_KEY = 'cloudtutor_recent_lecture';

export function Navbar() {
  const { user, logout, isMockMode } = useAuth();
  const location = useLocation();

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const [recentLecture, setRecentLecture] = useState(() => {
    try {
      const stored = localStorage.getItem(RECENT_LECTURE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const handleRecentUpdate = (e) => {
      if (e?.detail) {
        setRecentLecture(e.detail);
      } else {
        try {
          const stored = localStorage.getItem(RECENT_LECTURE_KEY);
          setRecentLecture(stored ? JSON.parse(stored) : null);
        } catch {
          setRecentLecture(null);
        }
      }
    };

    window.addEventListener('cloudtutor:recent_lecture_updated', handleRecentUpdate);
    window.addEventListener('storage', handleRecentUpdate);
    return () => {
      window.removeEventListener('cloudtutor:recent_lecture_updated', handleRecentUpdate);
      window.removeEventListener('storage', handleRecentUpdate);
    };
  }, []);

  const isActive = (path) => location.pathname === path;

  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div className="flex items-center space-x-3">
            <Link to="/" className="flex items-center space-x-2.5 group">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-md shadow-indigo-100 group-hover:scale-105 transition-transform">
                <Cloud className="w-5 h-5" />
              </div>
              <div>
                <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 bg-clip-text text-transparent">
                  CloudTutor
                </span>
              </div>
            </Link>
          </div>

          {/* Navigation Links for Authenticated Users */}
          {user && (
            <nav className="flex items-center space-x-1 sm:space-x-2">
              <Link
                to="/upload"
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive('/upload')
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <UploadCloud className="w-4 h-4" />
                <span>Tải lên video</span>
              </Link>
              <Link
                to="/videos"
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive('/videos')
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Video className="w-4 h-4" />
                <span>Thư viện Video</span>
              </Link>
              {recentLecture && (
                <Link
                  to={`/videos/${recentLecture.id}`}
                  title={recentLecture.title || 'Bài giảng đang xem'}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors max-w-[170px] sm:max-w-[240px] ${
                    location.pathname === `/videos/${recentLecture.id}`
                      ? 'bg-indigo-50 text-indigo-700 font-semibold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <PlayCircle className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span className="truncate">
                    {recentLecture.title || 'Bài giảng đang xem'}
                  </span>
                </Link>
              )}
            </nav>
          )}

          {/* User Profile / Status */}
          <div className="flex items-center space-x-3">
            {!isMockMode ? (
              <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                AWS Cognito Live
              </span>
            ) : (
              <span className="hidden md:inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded bg-amber-50 text-amber-800 border border-amber-200">
                <Shield className="w-3 h-3 text-amber-600" />
                Mock AWS Mode
              </span>
            )}

            {user ? (
              <div className="flex items-center space-x-3">
                <div className="hidden sm:flex flex-col text-right">
                  <span className="text-xs font-semibold text-slate-800">
                    {user.email}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Cognito Verified
                  </span>
                </div>
                <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs ring-2 ring-indigo-500/20">
                  {user.email?.[0]?.toUpperCase() || 'U'}
                </div>
                <button
                  type="button"
                  onClick={() => setShowLogoutConfirm(true)}
                  title="Đăng xuất"
                  className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-2">
                <Link
                  to="/login"
                  className="text-sm font-medium text-slate-600 hover:text-indigo-600 px-3 py-1.5"
                >
                  Đăng nhập
                </Link>
                <Link
                  to="/register"
                  className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-3.5 py-1.5 rounded-lg shadow-sm shadow-indigo-200 transition-colors"
                >
                  Đăng ký
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setShowLogoutConfirm(false)}
        >
          <div
            className="bg-white w-full max-w-sm rounded-2xl border border-slate-200 shadow-2xl p-6 text-center transform transition-all"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-3 shadow-inner">
              <LogOut className="w-6 h-6 ml-0.5" />
            </div>
            <h3 className="text-base font-bold text-slate-900 mb-1.5">
              Xác nhận đăng xuất
            </h3>
            <p className="text-xs text-slate-500 mb-6 leading-relaxed">
              Bạn có chắc chắn muốn đăng xuất khỏi tài khoản CloudTutor không?
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowLogoutConfirm(false);
                  logout();
                }}
                className="flex-1 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-200 transition-colors"
              >
                Đăng xuất
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
