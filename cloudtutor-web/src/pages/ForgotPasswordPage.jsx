import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  KeyRound,
  Mail,
  Lock,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Eye,
  EyeOff,
  ShieldCheck,
  Send
} from 'lucide-react';

export function ForgotPasswordPage() {
  const { forgotPassword, confirmPassword, isMockMode } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState(1); // 1: Input Email, 2: OTP & New Password, 3: Success
  const [email, setEmail] = useState(location.state?.email || '');
  const [code, setCode] = useState(isMockMode ? '123456' : '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');

  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (location.state?.email) {
      setEmail(location.state.email);
    }
  }, [location.state]);

  // Step 1: Request OTP code
  const handleRequestCode = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!email) {
      setError('Vui lòng nhập địa chỉ email.');
      return;
    }

    setLoading(true);
    try {
      const res = await forgotPassword(email);
      setStep(2);
      setSuccessMsg(res.message || `Mã xác thực OTP đã được gửi tới ${res.destination || email}`);
    } catch (err) {
      setError(err.message || 'Không thể gửi mã khôi phục mật khẩu.');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Confirm new password
  const handleConfirmPassword = async (e) => {
    e.preventDefault();
    setError('');
    setPasswordError('');
    setConfirmPasswordError('');

    let hasValidationError = false;
    if (newPassword.length < 8) {
      setPasswordError('Mật khẩu yêu cầu tối thiểu 8 ký tự (chữ hoa, chữ thường, số)');
      hasValidationError = true;
    }
    if (newPassword !== confirmNewPassword) {
      setConfirmPasswordError('Mật khẩu nhập lại không khớp');
      hasValidationError = true;
    }

    if (hasValidationError) {
      return;
    }

    setLoading(true);
    try {
      await confirmPassword(email, code.trim(), newPassword);
      setStep(3);
    } catch (err) {
      setError(err.message || 'Đặt lại mật khẩu không thành công.');
    } finally {
      setLoading(false);
    }
  };

  // Resend OTP code in Step 2
  const handleResend = async () => {
    if (!email) return;
    setError('');
    setResending(true);
    try {
      const res = await forgotPassword(email);
      setSuccessMsg(res.message || `Đã gửi lại mã xác thực mới tới ${res.destination || email}`);
    } catch (err) {
      setError(err.message || 'Không thể gửi lại mã xác thực.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 p-8">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="inline-flex p-3 rounded-2xl bg-indigo-50 text-indigo-600 mb-3 shadow-inner">
              {step === 3 ? (
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              ) : (
                <KeyRound className="w-6 h-6" />
              )}
            </div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              {step === 1 && 'Khôi phục mật khẩu'}
              {step === 2 && 'Đặt lại mật khẩu mới'}
              {step === 3 && 'Đổi mật khẩu thành công!'}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {step === 1 && 'Nhập email tài khoản để nhận mã xác thực OTP'}
              {step === 2 && `Nhập mã xác thực đã gửi tới ${email} và mật khẩu mới`}
              {step === 3 && 'Mật khẩu mới đã được cập nhật. Bạn có thể đăng nhập ngay.'}
            </p>
          </div>

          {/* Feedback: Error message */}
          {error && (
            <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs sm:text-sm flex items-start space-x-2.5">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Feedback: Success message (e.g. OTP sent notification) */}
          {successMsg && step !== 3 && (
            <div className="mb-5 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs sm:text-sm flex items-start space-x-2.5">
              <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Step 1: Input Email */}
          {step === 1 && (
            <form onSubmit={handleRequestCode} className="space-y-4">
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

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium text-sm rounded-xl shadow-lg shadow-indigo-200 transition-all flex items-center justify-center space-x-2"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <span>Gửi mã xác nhận OTP</span>
                    <Send className="w-4 h-4" />
                  </>
                )}
              </button>

              <div className="pt-2 text-center">
                <Link
                  to="/login"
                  className="inline-flex items-center text-xs font-medium text-slate-600 hover:text-indigo-600 transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                  Quay lại đăng nhập
                </Link>
              </div>
            </form>
          )}

          {/* Step 2: Enter OTP and Set New Password */}
          {step === 2 && (
            <form onSubmit={handleConfirmPassword} className="space-y-4">
              {/* Email Badge & Switch Option */}
              <div className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                <span className="text-slate-600 truncate font-mono font-medium max-w-[220px]">
                  {email}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setStep(1);
                    setError('');
                    setSuccessMsg('');
                  }}
                  className="text-indigo-600 hover:text-indigo-800 font-semibold text-[11px] hover:underline"
                >
                  Đổi email
                </button>
              </div>

              {/* OTP Code */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Mã xác nhận OTP (6 số)
                  </label>
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resending}
                    className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-medium disabled:opacity-50 hover:underline"
                  >
                    <RefreshCw className={`w-3 h-3 ${resending ? 'animate-spin' : ''}`} />
                    <span>Gửi lại mã</span>
                  </button>
                </div>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123456"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  />
                </div>
              </div>

              {/* New Password */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Mật khẩu mới
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      if (passwordError) setPasswordError('');
                    }}
                    placeholder="••••••••"
                    className={`w-full pl-10 pr-10 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 transition-all ${
                      passwordError
                        ? 'border-rose-400 bg-rose-50/20 focus:ring-rose-400/20 focus:border-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500/20 focus:border-indigo-500'
                    }`}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                    aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiển thị mật khẩu'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {passwordError && (
                  <p className="mt-1 text-xs text-rose-600 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{passwordError}</span>
                  </p>
                )}
              </div>

              {/* Confirm New Password */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Xác nhận lại mật khẩu mới
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    value={confirmNewPassword}
                    onChange={(e) => {
                      setConfirmNewPassword(e.target.value);
                      if (confirmPasswordError) setConfirmPasswordError('');
                    }}
                    placeholder="••••••••"
                    className={`w-full pl-10 pr-10 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 transition-all ${
                      confirmPasswordError
                        ? 'border-rose-400 bg-rose-50/20 focus:ring-rose-400/20 focus:border-rose-500'
                        : 'border-slate-200 focus:ring-indigo-500/20 focus:border-indigo-500'
                    }`}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                    aria-label={showConfirmPassword ? 'Ẩn mật khẩu' : 'Hiển thị mật khẩu'}
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {confirmPasswordError && (
                  <p className="mt-1 text-xs text-rose-600 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{confirmPasswordError}</span>
                  </p>
                )}
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
                    <span>Đặt lại mật khẩu</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="inline-flex items-center text-xs font-medium text-slate-600 hover:text-indigo-600 transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                  Hủy và quay lại đăng nhập
                </button>
              </div>
            </form>
          )}

          {/* Step 3: Success Screen */}
          {step === 3 && (
            <div className="text-center space-y-5">
              <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 text-xs sm:text-sm text-emerald-800 leading-relaxed">
                Mật khẩu tài khoản <strong className="font-semibold">{email}</strong> đã được cập nhật thành công. Bạn có thể sử dụng mật khẩu mới này để đăng nhập ngay bây giờ.
              </div>

              <button
                type="button"
                onClick={() => navigate('/login', { state: { email } })}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm rounded-xl shadow-lg shadow-indigo-200 transition-all flex items-center justify-center space-x-2"
              >
                <span>Đăng nhập ngay</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Security badge footer */}
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
