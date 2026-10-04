import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Mail, Lock, User, UserPlus, KeyRound, AlertCircle, CheckCircle, ArrowRight } from 'lucide-react';

export function RegisterPage() {
  const [step, setStep] = useState(1); // 1: Info form, 2: Verification code
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('123456');

  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const { register, confirmCode, isMockMode } = useAuth();
  const navigate = useNavigate();

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Mật khẩu nhập lại không khớp');
      return;
    }
    if (password.length < 8) {
      setError('Mật khẩu Cognito yêu cầu tối thiểu 8 ký tự');
      return;
    }

    setLoading(true);
    try {
      const res = await register(email, password, name);
      if (res.userConfirmed) {
        navigate('/login');
      } else {
        setStep(2);
        setSuccessMsg(res.message || 'Mã xác thực 6 số đã được gửi tới email của bạn');
      }
    } catch (err) {
      setError(err.message || 'Đăng ký thất bại');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmCode = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await confirmCode(email, verificationCode);
      alert('Tài khoản đã được xác thực thành công trên Cognito User Pool!');
      navigate('/login');
    } catch (err) {
      setError(err.message || 'Xác thực thất bại');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex p-3 rounded-2xl bg-indigo-50 text-indigo-600 mb-3 shadow-inner">
              <UserPlus className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              {step === 1 ? 'Tạo tài khoản CloudTutor' : 'Xác thực Email Cognito'}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {step === 1
                ? 'Đăng ký để tải lên và phân tích bài giảng đa phương tiện'
                : `Nhập mã xác nhận đã gửi đến ${email}`}
            </p>
          </div>

          {/* Feedback messages */}
          {error && (
            <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm flex items-start space-x-2.5">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && step === 2 && (
            <div className="mb-5 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-sm flex items-start space-x-2.5">
              <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {step === 1 ? (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Họ và tên
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Nguyễn Văn A"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Địa chỉ Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="student@cloudtutor.edu.vn"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Mật khẩu (Tối thiểu 8 ký tự)
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Xác nhận lại mật khẩu
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
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
                    <span>Đăng ký qua Cognito SDK</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleConfirmCode} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Mã xác nhận 6 số
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value)}
                    placeholder="123456"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm tracking-widest font-mono text-center font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
                {isMockMode && (
                  <p className="mt-1.5 text-xs text-indigo-600 font-medium text-center">
                    💡 Chế độ Mock: Mã mặc định là <b>123456</b>
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium text-sm rounded-xl shadow-lg shadow-indigo-200 transition-all flex items-center justify-center space-x-2"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <span>Kích hoạt tài khoản</span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setStep(1)}
                className="w-full text-center text-xs text-slate-500 hover:text-slate-800 py-1"
              >
                Quay lại sửa thông tin
              </button>
            </form>
          )}

          {/* Footer */}
          <div className="mt-6 pt-6 border-t border-slate-100 text-center text-sm text-slate-500">
            Đã có tài khoản?{' '}
            <Link to="/login" className="font-semibold text-indigo-600 hover:text-indigo-700">
              Đăng nhập ngay
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
