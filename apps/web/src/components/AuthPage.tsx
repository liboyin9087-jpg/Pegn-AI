import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Eye, EyeOff, ArrowRight, Mail, Lock, User, AlertCircle, Sparkles, Smartphone } from 'lucide-react';
import { login, register, setToken, oauthLogin, getOAuthStatus, requestPhoneOtp, verifyPhoneOtp } from '../api/client';

interface Props {
  onAuth: (user: any) => void;
}

type Mode = 'login' | 'register';
type AuthView = 'email' | 'phone' | 'otp';

// ── SVG icons for OAuth providers ──────────────────────────────────────
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908C16.658 14.226 17.64 11.92 17.64 9.2z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
      <path d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
    </svg>
  );
}

const FEATURES = [
  { icon: '✦', label: 'GraphRAG 語意搜尋' },
  { icon: '⚙️', label: 'AI Agent 自動化' },
  { icon: '🕸', label: '知識圖譜視覺化' },
  { icon: '✍️', label: 'AI 輔助寫作' },
];

export default function AuthPage({ onAuth }: Props) {
  const [mode, setMode] = useState<Mode>('login');
  const [authView, setAuthView] = useState<AuthView>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [otpRequestId, setOtpRequestId] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [retryAfter, setRetryAfter] = useState(0);
  const [expiresIn, setExpiresIn] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOAuthLoading] = useState<'google' | 'github' | null>(null);
  const [error, setError] = useState('');
  const [oauthStatus, setOAuthStatus] = useState({ google: false, github: false });

  useEffect(() => {
    getOAuthStatus().then(setOAuthStatus);
    // Check for OAuth error redirected back from server
    const hash = window.location.hash;
    if (hash.includes('error=')) {
      const params = new URLSearchParams(hash.slice(1));
      const oauthError = params.get('error');
      if (oauthError) {
        setError(decodeURIComponent(oauthError));
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
  }, []);

  useEffect(() => {
    if (authView !== 'otp') return;
    const timer = window.setInterval(() => {
      setRetryAfter((prev) => Math.max(0, prev - 1));
      setExpiresIn((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [authView]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (authView !== 'email') return;
    setError('');
    setLoading(true);
    try {
      const res = mode === 'login'
        ? await login(email, password)
        : await register(email, password, name);
      setToken(res.token);
      onAuth(res.user);
    } catch (err: any) {
      const msg = err.message ?? '';
      setError(
        msg.includes('409') || msg.includes('already') ? '此 Email 已被註冊，請直接登入'
        : msg.includes('401') || msg.includes('Invalid') ? '帳號或密碼錯誤'
        : '操作失敗，請重試'
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await requestPhoneOtp(phone);
      setOtpRequestId(res.otp_request_id);
      setRetryAfter(res.retry_after ?? 0);
      setExpiresIn(res.expires_in ?? 0);
      setOtpCode('');
      setAuthView('otp');
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('404') || msg.includes('501') || msg.includes('failed')) {
        setAuthView('email');
        setError('手機驗證暫不可用，請改用 Email 登入');
      } else if (msg.includes('429')) {
        setError('發送太頻繁，請稍後重試');
      } else {
        setError('發送驗證碼失敗，請重試');
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await verifyPhoneOtp(otpRequestId, otpCode, phone);
      setToken(res.token);
      onAuth(res.user);
    } catch (err: any) {
      const msg = err?.message ?? '';
      setError(
        msg.includes('401') ? '驗證碼錯誤，請重新輸入'
        : msg.includes('410') ? '驗證碼已過期，請重發'
        : msg.includes('429') ? '嘗試次數過多，請稍後再試'
        : '驗證失敗，請重試'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = (provider: 'google' | 'github') => {
    setOAuthLoading(provider);
    oauthLogin(provider);
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setAuthView('email');
    setError('');
    setEmail('');
    setPassword('');
    setName('');
    setPhone('');
    setOtpRequestId('');
    setOtpCode('');
    setRetryAfter(0);
    setExpiresIn(0);
  };

  const hasOAuth = oauthStatus.google || oauthStatus.github;

  return (
    <div className="min-h-screen flex" style={{ background: '#fafafa' }}>

      {/* ── Left: form ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          style={{ width: '100%', maxWidth: 400 }}
        >
          {/* Logo */}
          <div className="flex items-center gap-2.5 mb-10">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #2383e2, #7c3aed)' }}
            >
              <span style={{ fontSize: 19, fontWeight: 800, color: 'white', letterSpacing: '-0.5px' }}>P</span>
            </div>
            <span style={{ fontSize: 19, fontWeight: 700, color: '#1a1a2e', letterSpacing: '-0.4px' }}>Pegn AI</span>
          </div>

          {/* Heading */}
          <div className="mb-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={mode}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
              >
                <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1a1a2e', letterSpacing: '-0.6px', marginBottom: 6, lineHeight: 1.2 }}>
                  {authView === 'phone' ? '手機驗證登入' : authView === 'otp' ? '輸入驗證碼' : mode === 'login' ? '歡迎回來' : '建立你的帳號'}
                </h1>
                <p style={{ fontSize: 14, color: '#6b6b7a' }}>
                  {authView === 'phone'
                    ? '輸入手機號碼，取得一次性驗證碼'
                    : authView === 'otp'
                      ? '請輸入 6 碼驗證碼完成登入'
                      : mode === 'login'
                        ? '登入以繼續你的工作區'
                        : '立即開始建立 AI 知識庫'}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* OAuth buttons */}
          {hasOAuth && authView === 'email' && (
            <div className="flex flex-col gap-2.5 mb-6">
              {oauthStatus.google && (
                <OAuthButton
                  icon={oauthLoading === 'google'
                    ? <Spinner color="border-blue-400" />
                    : <GoogleIcon />}
                  label="以 Google 繼續"
                  onClick={() => handleOAuth('google')}
                  disabled={!!oauthLoading || loading}
                  faded={!!oauthLoading && oauthLoading !== 'google'}
                />
              )}
              {oauthStatus.github && (
                <OAuthButton
                  icon={oauthLoading === 'github'
                    ? <Spinner color="border-gray-600" />
                    : <GitHubIcon />}
                  label="以 GitHub 繼續"
                  onClick={() => handleOAuth('github')}
                  disabled={!!oauthLoading || loading}
                  faded={!!oauthLoading && oauthLoading !== 'github'}
                />
              )}
              <Divider />
            </div>
          )}

          {/* Email form */}
          <form onSubmit={authView === 'email' ? handleSubmit : authView === 'phone' ? handlePhoneRequest : handlePhoneVerify} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {authView === 'email' ? (
              <>
                <AnimatePresence initial={false}>
                  {mode === 'register' && (
                    <motion.div
                      key="name"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      style={{ overflow: 'hidden' }}
                    >
                      <InputField
                        icon={<User size={14} />}
                        type="text"
                        placeholder="你的名字"
                        value={name}
                        onChange={setName}
                        required
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                <InputField
                  icon={<Mail size={14} />}
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={setEmail}
                  required
                />

                <div className="relative">
                  <InputField
                    icon={<Lock size={14} />}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="至少 6 個字元"
                    value={password}
                    onChange={setPassword}
                    required
                    minLength={6}
                    extraPaddingRight
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
                    style={{ color: '#a0a0ae' }}
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>

                {mode === 'login' && (
                  <div className="flex justify-end" style={{ marginTop: -4 }}>
                    <button type="button" style={{ fontSize: 12, color: '#2383e2' }}>忘記密碼？</button>
                  </div>
                )}
              </>
            ) : authView === 'phone' ? (
              <InputField
                icon={<Smartphone size={14} />}
                type="tel"
                placeholder="手機號碼（例：+886912345678）"
                value={phone}
                onChange={setPhone}
                required
              />
            ) : (
              <>
                <InputField
                  icon={<Lock size={14} />}
                  type="text"
                  placeholder="6 碼驗證碼"
                  value={otpCode}
                  onChange={(v) => setOtpCode(v.replace(/\D/g, '').slice(0, 6))}
                  required
                  maxLength={6}
                  inputMode="numeric"
                />
                <div className="flex items-center justify-between px-1" style={{ fontSize: 12, color: '#6b6b7a' }}>
                  <span>驗證碼剩餘 {Math.max(0, expiresIn)} 秒</span>
                  <button
                    type="button"
                    onClick={async () => {
                      if (retryAfter > 0 || loading) return;
                      setError('');
                      setLoading(true);
                      try {
                        const res = await requestPhoneOtp(phone);
                        setOtpRequestId(res.otp_request_id);
                        setRetryAfter(res.retry_after ?? 0);
                        setExpiresIn(res.expires_in ?? 0);
                      } catch {
                        setError('重發驗證碼失敗，請稍後再試');
                      } finally {
                        setLoading(false);
                      }
                    }}
                    disabled={retryAfter > 0 || loading}
                    style={{ color: retryAfter > 0 ? '#a0a0ae' : '#2383e2', fontWeight: 600 }}
                  >
                    {retryAfter > 0 ? `重發 (${retryAfter}s)` : '重發驗證碼'}
                  </button>
                </div>
              </>
            )}

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl"
                    style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                    <AlertCircle size={13} style={{ color: '#dc2626', flexShrink: 0, marginTop: 1 }} />
                    <span style={{ fontSize: 12.5, color: '#dc2626', lineHeight: 1.5 }}>{error}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={loading || !!oauthLoading || (authView === 'otp' && otpCode.length !== 6)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-white"
              style={{
                fontSize: 14, fontWeight: 600, marginTop: 4,
                background: 'linear-gradient(135deg, #2383e2, #7c3aed)',
                opacity: loading || !!oauthLoading ? 0.7 : 1,
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => { if (!loading && !oauthLoading) e.currentTarget.style.opacity = '0.88'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = loading || !!oauthLoading ? '0.7' : '1'; }}
            >
              {loading
                ? <Spinner color="border-white/40" />
                : <>
                    <span>
                      {authView === 'phone' ? '發送驗證碼' : authView === 'otp' ? '驗證並登入' : mode === 'login' ? '登入' : '建立帳號'}
                    </span>
                    <ArrowRight size={15} />
                  </>
              }
            </button>

            {mode === 'login' && authView === 'email' && (
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setAuthView('phone');
                }}
                className="w-full py-2.5 rounded-xl border"
                style={{ fontSize: 13, fontWeight: 600, borderColor: '#e8e8ea', color: '#2383e2', background: 'white' }}
              >
                改用手機驗證碼登入
              </button>
            )}

            {authView !== 'email' && (
              <button
                type="button"
                onClick={() => {
                  setAuthView('email');
                  setError('');
                  setOtpCode('');
                }}
                className="w-full py-2.5 rounded-xl border"
                style={{ fontSize: 13, fontWeight: 600, borderColor: '#e8e8ea', color: '#6b6b7a', background: 'white' }}
              >
                返回 Email 登入
              </button>
            )}
          </form>

          {/* Switch mode */}
          {authView === 'email' && (
            <p className="text-center mt-6" style={{ fontSize: 13, color: '#6b6b7a' }}>
              {mode === 'login' ? '還沒有帳號？' : '已有帳號？'}
              {' '}
              <button
                onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
                style={{ color: '#2383e2', fontWeight: 600 }}
              >
                {mode === 'login' ? '免費註冊' : '立即登入'}
              </button>
            </p>
          )}

          <p className="text-center mt-4" style={{ fontSize: 11, color: '#b0b0be' }}>
            繼續使用即代表同意
            <button style={{ color: '#6b6b7a' }}> 服務條款 </button>
            與
            <button style={{ color: '#6b6b7a' }}> 隱私政策</button>
          </p>
        </motion.div>
      </div>

      {/* ── Right: Visual ── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="hidden lg:flex flex-col items-center justify-center flex-1 relative overflow-hidden"
        style={{ background: 'linear-gradient(145deg, #0c0e1a 0%, #1a1040 55%, #0c0e1a 100%)', minHeight: '100vh' }}
      >
        {/* Glow blobs */}
        <div className="absolute inset-0 pointer-events-none">
          <div style={{
            position: 'absolute', top: '12%', left: '18%',
            width: 340, height: 340, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(35,131,226,0.16) 0%, transparent 70%)',
          }} />
          <div style={{
            position: 'absolute', bottom: '18%', right: '12%',
            width: 300, height: 300, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(124,58,237,0.16) 0%, transparent 70%)',
          }} />
        </div>

        <div className="relative z-10 px-14 text-center" style={{ maxWidth: 460 }}>
          {/* Icon */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            style={{
              width: 64, height: 64, borderRadius: 18, margin: '0 auto 28px',
              background: 'linear-gradient(135deg, #2383e2, #7c3aed)',
              boxShadow: '0 20px 48px rgba(35,131,226,0.28)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Sparkles size={30} style={{ color: 'white' }} />
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.4 }}
            style={{ fontSize: 30, fontWeight: 700, color: 'white', letterSpacing: '-0.8px', lineHeight: 1.25, marginBottom: 14 }}
          >
            讓 AI 消失在<br />工作流裡
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.4 }}
            style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', lineHeight: 1.75, marginBottom: 36 }}
          >
            寫作、搜尋、分析——AI 在你需要時出現，<br />不需要時隱身。
          </motion.p>

          {/* Feature pills */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 0.4 }}
            className="flex flex-wrap gap-2 justify-center mb-10"
          >
            {FEATURES.map((f, i) => (
              <motion.span
                key={f.label}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.75 + i * 0.07 }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: 12.5, fontWeight: 500,
                  color: 'rgba(255,255,255,0.75)',
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 999, padding: '6px 12px',
                }}
              >
                {f.icon} {f.label}
              </motion.span>
            ))}
          </motion.div>

          {/* Mock editor card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.0, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.09)',
              borderRadius: 16,
              padding: '16px 20px',
              textAlign: 'left',
            }}
          >
            <div className="flex items-center gap-1.5 mb-3">
              {[1,2,3].map(i => (
                <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(255,255,255,0.12)' }} />
              ))}
            </div>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 8, fontFamily: 'monospace' }}>📝 Q3 產品規劃.md</p>
            <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.75)', lineHeight: 1.7, fontFamily: 'monospace' }}>
              <span style={{ color: '#60a5fa' }}>✦ AI ›</span>{' '}
              <span style={{ color: 'rgba(255,255,255,0.5)' }}>根據你的文件，本季重點應聚焦於</span><br />
              <span style={{ paddingLeft: 20, color: 'rgba(255,255,255,0.4)' }}>搜尋體驗優化與協作功能整合...</span>
            </p>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────
function Spinner({ color }: { color: string }) {
  return (
    <div
      className={`w-4 h-4 rounded-full border-2 ${color} border-t-transparent animate-spin`}
    />
  );
}

function OAuthButton({ icon, label, onClick, disabled, faded }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled: boolean;
  faded: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center justify-center gap-3 py-2.5 rounded-xl border transition-all"
      style={{
        fontSize: 14, fontWeight: 500,
        color: '#1a1a2e', borderColor: '#e8e8ea', background: 'white',
        opacity: faded ? 0.45 : 1,
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = '#f7f7f8'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'white'; }}
    >
      {icon}
      {label}
    </button>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3 mt-1">
      <div className="flex-1" style={{ borderTop: '1px solid #e8e8ea' }} />
      <span style={{ fontSize: 12, color: '#a0a0ae', whiteSpace: 'nowrap' }}>或使用 Email 登入</span>
      <div className="flex-1" style={{ borderTop: '1px solid #e8e8ea' }} />
    </div>
  );
}

interface InputFieldProps {
  icon: React.ReactNode;
  type: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  minLength?: number;
  extraPaddingRight?: boolean;
  maxLength?: number;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}

function InputField({ icon, type, placeholder, value, onChange, required, minLength, extraPaddingRight, maxLength, inputMode }: InputFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <div
      className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl border transition-all"
      style={{
        background: focused ? 'white' : '#f7f7f8',
        borderColor: focused ? '#2383e2' : '#e8e8ea',
        boxShadow: focused ? '0 0 0 3px rgba(35,131,226,0.1)' : 'none',
      }}
    >
      <span style={{ color: focused ? '#2383e2' : '#b0b0be', flexShrink: 0, transition: 'color 0.15s' }}>
        {icon}
      </span>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        inputMode={inputMode}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="flex-1 outline-none bg-transparent"
        style={{ fontSize: 14, color: '#1a1a2e', paddingRight: extraPaddingRight ? 28 : undefined }}
      />
    </div>
  );
}
