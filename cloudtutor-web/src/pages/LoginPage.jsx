import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Mail, Lock, LogIn, Sparkles, AlertCircle, ArrowRight, ShieldCheck, CheckCircle2 } from 'lucide-react';

export function LoginPage() {
  const { login, quickDemoLogin, isMockMode, cognitoConfig } = useAuth();

  const [email, setEmail] = useState(isMockMode ? 'student@cloudtutor.edu.vn' : '');
  const [password, setPassword] = useState(isMockMode ? 'DemoPassword123!' : '');
  const [error, setError] = useState('');
  const [unconfirmedEmail, setUnconfirmedEmail] = useState(null);
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from?.pathname || '/upload';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setUnconfirmedEmail(null);
    setLoading(true);

    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'Đăng nhập không thành công');
      if (err.code === 'UserNotConfirmedException') {
        setUnconfirmedEmail(email);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemo = async () => {
    setError('');
    setLoading(true);
    try {
      await quickDemoLogin();
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'Lỗi đăng nhập nhanh');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-md">
        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 p-8">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="inline-flex p-3 rounded-2xl bg-indigo-50 text-indigo-600 mb-3 shadow-inner">
              <LogIn className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Đăng nhập CloudTutor
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Hệ thống xử lý học liệu đa định dạng trên Cloud
            </p>
          </div>

          {/* Connection Mode Indicator */}
          {!isMockMode ? (
            <div className="mb-6 p-3 bg-emerald-50/90 rounded-xl border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between shadow-sm">
              <div className="flex items-center space-x-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
                <div>
                  <span className="font-semibold block">AWS Cognito SDK Live</span>
                  <span className="text-[11px] text-emerald-700 font-mono">
                    Pool: {cognitoConfig?.userPoolId ? `${cognitoConfig.userPoolId.substring(0, 16)}...` : 'Live'} ({cognitoConfig?.region || 'ap-southeast-1'})
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">
                Trực tiếp
              </span>
            </div>
          ) : (
            <div className="mb-6 p-3.5 bg-gradient-to-r from-indigo-50/80 to-purple-50/80 rounded-xl border border-indigo-100 text-xs text-indigo-900">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                  <span className="font-semibold">Môi trường kiểm thử Mock</span>
                </div>
                <button
                  type="button"
                  onClick={handleQuickDemo}
                  className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium transition-all shadow-sm"
                >
                  1-Click Đăng nhập Demo
                </button>
              </div>
              <p className="mt-1 text-slate-600">
                Chế độ mock dữ liệu mẫu. Để kết nối thật, hãy khai báo biến trong tệp .env.
              </p>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs sm:text-sm flex flex-col space-y-1.5">
              <div className="flex items-start space-x-2.5">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
              {unconfirmedEmail && (
                <div className="mt-2 pt-2 border-t border-rose-200 pl-6">
                  <button
                    type="button"
                    onClick={() => navigate('/register', { state: { email: unconfirmedEmail, step: 2 } })}
                    className="text-xs font-semibold text-rose-800 underline hover:text-rose-950"
                  >
                    Nhấp vào đây để nhập mã kích hoạt OTP gửi tới {unconfirmedEmail}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Email tài khoản
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Mật khẩu
                </label>
                <span className="text-xs text-indigo-600 hover:underline cursor-pointer">
                  Quên mật khẩu?
                </span>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium text-sm rounded-xl shadow-lg shadow-indigo-200 transition-all flex items-center justify-center space-x-2"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span>Xác thực với Cognito</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="mt-6 pt-6 border-t border-slate-100 text-center text-sm text-slate-500">
            Chưa có tài khoản trên User Pool?{' '}
            <Link to="/register" className="font-semibold text-indigo-600 hover:text-indigo-700">
              Đăng ký tài khoản mới
            </Link>
          </div>
        </div>

        {/* Note on architecture */}
        <div className="mt-4 text-center">
          <span className="inline-flex items-center text-xs text-slate-600 gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            Chuẩn bảo mật AWS Cognito User Pools & JWT Token
          </span>
        </div>
      </div>
    </div>
  );
}
