import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Mail, CheckCircle2, XCircle, RefreshCw, KeyRound, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isRTL } from "@/i18n";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { clearCsrfToken } from "@/lib/queryClient";
import TurnstileWidget from "@/components/TurnstileWidget";
import { apiUrl } from "@/lib/apiBase";

export default function AuthPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const dir = isRTL(i18n.language) ? 'rtl' : 'ltr';
  const [mode, setMode] = useState<'login' | 'register' | 'forgot' | 'reset'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [verificationSent, setVerificationSent] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');
  const [verifiedStatus, setVerifiedStatus] = useState<'success' | 'invalid' | 'error' | null>(null);
  const [resetToken, setResetToken] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [requires2fa, setRequires2fa] = useState(false);
  const [tempToken2fa, setTempToken2fa] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [verifying2fa, setVerifying2fa] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  const resetTurnstile = useCallback(() => {
    setTurnstileToken('');
    setTurnstileResetKey(k => k + 1);
  }, []);

  const { login, googleLogin, register, resendVerification } = useAuth();

  const { data: turnstileConfig } = useQuery({
    queryKey: ["/api/v1/auth/turnstile-config"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/v1/auth/turnstile-config"));
      return res.json() as Promise<{ siteKey: string; enabled: boolean }>;
    },
    staleTime: Infinity,
  });

  const { data: googleConfig } = useQuery({
    queryKey: ["/api/v1/auth/google-config"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/v1/auth/google-config"));
      return res.json() as Promise<{ clientId: string; enabled: boolean }>;
    },
    staleTime: Infinity,
  });

  const googleBtnRef = useRef<HTMLDivElement | null>(null);
  const [gsiReady, setGsiReady] = useState(false);

  const handleGoogleCredential = useCallback(async (response: { credential?: string }) => {
    if (!response?.credential) return;
    setError('');
    try {
      await googleLogin.mutateAsync({ credential: response.credential });
    } catch (err: any) {
      try {
        const text = err.message.includes('{') ? err.message.slice(err.message.indexOf('{')) : err.message;
        const parsed = JSON.parse(text);
        setError(parsed.message || t('auth.googleError'));
      } catch {
        setError(t('auth.googleError'));
      }
    }
  }, [googleLogin, t]);

  // Load Google Identity Services script once, when Google sign-in is configured
  useEffect(() => {
    if (!googleConfig?.enabled || !googleConfig.clientId) return;
    if ((window as any).google?.accounts?.id) { setGsiReady(true); return; }
    if (document.getElementById('google-gsi-script')) return;
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.id = 'google-gsi-script';
    s.onload = () => setGsiReady(true);
    document.head.appendChild(s);
  }, [googleConfig?.enabled, googleConfig?.clientId]);

  // Initialize + render the Google button on the login/register view
  useEffect(() => {
    if (!gsiReady || !googleConfig?.clientId) return;
    if (requires2fa || verificationSent || mode === 'forgot' || mode === 'reset') return;
    const g = (window as any).google;
    if (!g?.accounts?.id || !googleBtnRef.current) return;
    g.accounts.id.initialize({ client_id: googleConfig.clientId, callback: handleGoogleCredential });
    googleBtnRef.current.innerHTML = '';
    g.accounts.id.renderButton(googleBtnRef.current, {
      theme: 'filled_black',
      size: 'large',
      width: 320,
      text: 'continue_with',
      shape: 'rectangular',
      logo_alignment: 'center',
      locale: i18n.language,
    });
  }, [gsiReady, googleConfig?.clientId, mode, requires2fa, verificationSent, handleGoogleCredential, i18n.language]);

  const turnstileEnabled = turnstileConfig?.enabled ?? false;
  const turnstileSiteKey = turnstileConfig?.siteKey ?? "";
  const turnstileReady = !turnstileEnabled || !!turnstileToken;

  const handleTurnstileVerify = useCallback((token: string) => {
    setTurnstileToken(token);
  }, []);

  const handleTurnstileExpire = useCallback(() => {
    setTurnstileToken('');
  }, []);

  const handleTurnstileError = useCallback(() => {
    setTurnstileToken('');
    setError(t('auth.turnstile.error'));
  }, [t]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verified = params.get('verified');
    if (verified === 'success' || verified === 'invalid' || verified === 'error') {
      setVerifiedStatus(verified);
      setMode('login');
      window.history.replaceState({}, '', '/');
    }
    const reset = params.get('reset');
    if (reset) {
      setResetToken(reset);
      setMode('reset');
      window.history.replaceState({}, '', '/');
    }
    const ref = params.get('ref');
    if (ref) {
      localStorage.setItem('vertex_referral_code', ref);
      setMode('register');
      window.history.replaceState({}, '', '/');
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setVerifiedStatus(null);
    setSuccessMessage('');

    if (!turnstileReady) {
      setError(t('auth.turnstile.required'));
      return;
    }

    try {
      if (mode === 'login') {
        const result = await login.mutateAsync({ email, password, turnstileToken: turnstileToken || undefined });
        if (result.requires2fa) {
          setRequires2fa(true);
          setTempToken2fa(result.tempToken);
          setError('');
          return;
        }
      } else {
        if (!name.trim()) { setError(t('auth.nameRequired')); return; }
        const referralCode = localStorage.getItem('vertex_referral_code') || undefined;
        const result = await register.mutateAsync({ name, email, password, referralCode, turnstileToken: turnstileToken || undefined });
        if (referralCode) localStorage.removeItem('vertex_referral_code');
        if (result.needsVerification) {
          setVerificationSent(true);
          setPendingEmail(email);
          return;
        }
      }
    } catch (err: any) {
      try {
        const text = err.message.includes('{') ? err.message.slice(err.message.indexOf('{')) : err.message;
        const parsed = JSON.parse(text);
        if (parsed.needsVerification) {
          setVerificationSent(true);
          setPendingEmail(parsed.email || email);
          setError('');
          return;
        }
        if (err.message?.includes('403') || parsed.message?.includes('אימות אנושי')) {
          setError(t('auth.turnstile.error'));
        } else if (parsed.remainingMinutes) {
          setError(t('auth.accountLocked', { minutes: parsed.remainingMinutes }));
        } else {
          setError(parsed.message || t('auth.error'));
        }
      } catch {
        if (err.message?.includes('403')) {
          setError(t('auth.turnstile.error'));
        } else {
          setError(mode === 'login' ? t('auth.invalidCredentials') : t('auth.registerError'));
        }
      }
    } finally {
      resetTurnstile();
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    if (!email) { setError(t('auth.emailRequired')); return; }
    if (!turnstileReady) { setError(t('auth.turnstile.required')); return; }
    setForgotLoading(true);
    try {
      const res = await apiRequest("POST", "/api/v1/auth/forgot-password", { email, turnstileToken: turnstileToken || undefined });
      const data = await res.json();
      setSuccessMessage(data.message);
    } catch (err: any) {
      if (err.message?.includes('403')) {
        setError(t('auth.turnstile.error'));
      } else {
        setSuccessMessage(t('auth.resetSentMessage'));
      }
    } finally {
      setForgotLoading(false);
      resetTurnstile();
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    if (password.length < 8) { setError(t('auth.passwordMinLength')); return; }
    if (password !== confirmPassword) { setError(t('auth.passwordsNoMatch')); return; }
    setResetLoading(true);
    try {
      const res = await apiRequest("POST", "/api/v1/auth/reset-password", { token: resetToken, password });
      const data = await res.json();
      if (res.ok) {
        setSuccessMessage(data.message);
        setTimeout(() => { setMode('login'); setSuccessMessage(''); setPassword(''); setConfirmPassword(''); }, 2000);
      } else {
        setError(data.message);
      }
    } catch {
      setError(t('auth.resetError'));
    } finally {
      setResetLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      await resendVerification.mutateAsync({ email: pendingEmail });
    } catch {
    }
  };

  const handle2faVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!totpCode.trim()) { setError(t('auth.twoFactor.codeRequired')); return; }
    setVerifying2fa(true);
    try {
      const res = await apiRequest("POST", "/api/v1/auth/2fa/login-verify", { code: totpCode, tempToken: tempToken2fa });
      const data = await res.json();
      if (res.ok && data.id) {
        clearCsrfToken();
        queryClient.invalidateQueries({ queryKey: ["/api/v1/auth/me"] });
      } else {
        setError(data.message || t('auth.twoFactor.invalidCode'));
      }
    } catch {
      setError(t('auth.twoFactor.invalidCode'));
    } finally {
      setVerifying2fa(false);
    }
  };

  const isLoading = login.isPending || register.isPending;

  if (requires2fa) {
    return (
      <div dir={dir} className="h-full overflow-auto bg-background flex items-start justify-center pt-[10vh] pb-8 px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <img src="/logo.png" alt="Vertex Command" className="w-12 h-12 rounded-xl object-contain mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-foreground">{t('app.name').toUpperCase()}</h1>
          </div>

          <div className="bg-card rounded-lg border border-border p-6 shadow-lg">
            <div className="w-16 h-16 rounded-full bg-indigo-600/10 border border-indigo-600/20 flex items-center justify-center mx-auto mb-4">
              <ShieldCheck className="w-8 h-8 text-indigo-400" />
            </div>
            <h2 className="text-lg font-bold text-foreground mb-2 text-center" data-testid="text-2fa-title">{t('auth.twoFactor.title')}</h2>
            <p className="text-sm text-muted-foreground text-center mb-4">{t('auth.twoFactor.enterCode')}</p>

            <form onSubmit={handle2faVerify} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">{t('auth.twoFactor.code')}</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9a-fA-F]*"
                  maxLength={8}
                  value={totpCode}
                  onChange={e => setTotpCode(e.target.value)}
                  placeholder={t('auth.twoFactor.codePlaceholder')}
                  className="bg-secondary/50 border-border text-sm h-10 text-center tracking-widest"
                  dir="ltr"
                  data-testid="input-2fa-code"
                  autoFocus
                  required
                />
              </div>

              {error && <p className="text-sm text-red-500 bg-red-500/10 rounded-md px-3 py-2 border border-red-500/20" data-testid="text-error">{error}</p>}

              <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white h-10 text-sm font-medium" disabled={verifying2fa} data-testid="button-2fa-verify">
                {verifying2fa ? <Loader2 className="w-4 h-4 animate-spin" /> : t('auth.twoFactor.verify')}
              </Button>

              <p className="text-xs text-muted-foreground text-center">{t('auth.twoFactor.backupHint')}</p>

              <Button
                type="button"
                variant="ghost"
                className="w-full text-sm h-10 text-muted-foreground"
                onClick={() => { setRequires2fa(false); setTotpCode(''); setError(''); }}
                data-testid="button-2fa-back"
              >
                {t('auth.backToLogin')}
              </Button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (verificationSent) {
    return (
      <div dir={dir} className="h-full overflow-auto bg-background flex items-start justify-center pt-[10vh] pb-8 px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <img src="/logo.png" alt="Vertex Command" className="w-12 h-12 rounded-xl object-contain mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-foreground">{t('app.name').toUpperCase()}</h1>
          </div>

          <div className="bg-card rounded-lg border border-border p-6 shadow-lg text-center">
            <div className="w-16 h-16 rounded-full bg-indigo-600/10 border border-indigo-600/20 flex items-center justify-center mx-auto mb-4">
              <Mail className="w-8 h-8 text-indigo-400" />
            </div>
            <h2 className="text-lg font-bold text-foreground mb-2" data-testid="text-verification-title">{t('auth.checkEmail')}</h2>
            <p className="text-sm text-muted-foreground mb-1">{t('auth.verificationSent')}</p>
            <p className="text-sm font-medium text-foreground mb-4" dir="ltr" data-testid="text-verification-email">{pendingEmail}</p>
            <p className="text-xs text-muted-foreground mb-6">{t('auth.verificationHelp')}</p>

            <div className="space-y-3">
              <Button
                variant="outline"
                className="w-full text-sm h-10"
                onClick={handleResend}
                disabled={resendVerification.isPending}
                data-testid="button-resend"
              >
                {resendVerification.isPending ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <RefreshCw className="w-4 h-4 ml-2" />}
                {t('auth.resend')}
              </Button>
              <Button
                variant="ghost"
                className="w-full text-sm h-10 text-muted-foreground"
                onClick={() => { setVerificationSent(false); setMode('login'); }}
                data-testid="button-back-to-login"
              >
                {t('auth.backToLogin')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'forgot') {
    return (
      <div dir={dir} className="h-full overflow-auto bg-background flex items-start justify-center pt-[10vh] pb-8 px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <img src="/logo.png" alt="Vertex Command" className="w-12 h-12 rounded-xl object-contain mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-foreground">{t('app.name').toUpperCase()}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t('auth.resetPassword')}</p>
          </div>

          <div className="bg-card rounded-lg border border-border p-6 shadow-lg">
            <div className="w-12 h-12 rounded-full bg-indigo-600/10 border border-indigo-600/20 flex items-center justify-center mx-auto mb-4">
              <KeyRound className="w-6 h-6 text-indigo-400" />
            </div>
            <p className="text-sm text-muted-foreground text-center mb-4">{t('auth.resetPasswordDesc')}</p>

            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">{t('auth.email')}</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={t('auth.emailPlaceholder')}
                  className="bg-secondary/50 border-border text-sm h-10"
                  dir="ltr"
                  data-testid="input-forgot-email"
                  required
                />
              </div>

              {turnstileEnabled && turnstileSiteKey && (
                <TurnstileWidget
                  siteKey={turnstileSiteKey}
                  onVerify={handleTurnstileVerify}
                  onExpire={handleTurnstileExpire}
                  onError={handleTurnstileError}
                  resetKey={turnstileResetKey}
                />
              )}

              {error && <p className="text-sm text-red-500 bg-red-500/10 rounded-md px-3 py-2 border border-red-500/20" data-testid="text-error">{error}</p>}
              {successMessage && (
                <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <p className="text-sm text-emerald-400" data-testid="text-forgot-success">{successMessage}</p>
                </div>
              )}

              <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white h-10 text-sm font-medium" disabled={forgotLoading || !turnstileReady} data-testid="button-forgot-submit">
                {forgotLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : t('auth.sendResetLink')}
              </Button>
              <Button type="button" variant="ghost" className="w-full text-sm h-10 text-muted-foreground" onClick={() => { setMode('login'); setError(''); setSuccessMessage(''); resetTurnstile(); }} data-testid="button-back-to-login">
                {t('auth.backToLogin')}
              </Button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'reset') {
    return (
      <div dir={dir} className="h-full overflow-auto bg-background flex items-start justify-center pt-[10vh] pb-8 px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <img src="/logo.png" alt="Vertex Command" className="w-12 h-12 rounded-xl object-contain mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-foreground">{t('app.name').toUpperCase()}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t('auth.newPassword')}</p>
          </div>

          <div className="bg-card rounded-lg border border-border p-6 shadow-lg">
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">{t('auth.newPassword')}</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={t('auth.newPasswordPlaceholder')}
                  className="bg-secondary/50 border-border text-sm h-10"
                  dir="ltr"
                  data-testid="input-reset-password"
                  required
                  minLength={8}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">{t('auth.confirmPassword')}</Label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder={t('auth.confirmPasswordPlaceholder')}
                  className="bg-secondary/50 border-border text-sm h-10"
                  dir="ltr"
                  data-testid="input-reset-confirm"
                  required
                  minLength={8}
                />
              </div>

              {error && <p className="text-sm text-red-500 bg-red-500/10 rounded-md px-3 py-2 border border-red-500/20" data-testid="text-error">{error}</p>}
              {successMessage && (
                <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <p className="text-sm text-emerald-400" data-testid="text-reset-success">{successMessage}</p>
                </div>
              )}

              <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white h-10 text-sm font-medium" disabled={resetLoading} data-testid="button-reset-submit">
                {resetLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : t('auth.updatePassword')}
              </Button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div dir={dir} className="h-full overflow-auto bg-background flex items-start justify-center pt-[10vh] pb-8 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Vertex Command" className="w-12 h-12 rounded-xl object-contain mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-foreground">{t('app.name').toUpperCase()}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('app.tagline')}</p>
          <div className="mt-3"><LanguageSwitcher /></div>
        </div>

        {verifiedStatus === 'success' && (
          <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-3 mb-4" data-testid="text-verified-success">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <p className="text-sm text-emerald-400">{t('auth.emailVerified')}</p>
          </div>
        )}
        {verifiedStatus === 'invalid' && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 mb-4" data-testid="text-verified-invalid">
            <XCircle className="w-5 h-5 text-red-400 shrink-0" />
            <p className="text-sm text-red-400">{t('auth.verifyInvalid')}</p>
          </div>
        )}
        {verifiedStatus === 'error' && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 mb-4" data-testid="text-verified-error">
            <XCircle className="w-5 h-5 text-red-400 shrink-0" />
            <p className="text-sm text-red-400">{t('auth.verifyError')}</p>
          </div>
        )}

        <div className="bg-card rounded-lg border border-border p-6 shadow-lg">
          <div className="flex bg-secondary/50 rounded-lg p-0.5 mb-6 border border-border">
            <button
              onClick={() => { setMode('login'); setError(''); setVerifiedStatus(null); resetTurnstile(); }}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${mode === 'login' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
              data-testid="tab-login"
            >
              {t('auth.login')}
            </button>
            <button
              onClick={() => { setMode('register'); setError(''); setVerifiedStatus(null); resetTurnstile(); }}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${mode === 'register' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
              data-testid="tab-register"
            >
              {t('auth.register')}
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">{t('auth.name')}</Label>
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t('auth.namePlaceholder')}
                  className="bg-secondary/50 border-border text-sm h-10"
                  data-testid="input-name"
                  autoComplete="name"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">{t('auth.email')}</Label>
              <Input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t('auth.emailPlaceholder')}
                className="bg-secondary/50 border-border text-sm h-10"
                dir="ltr"
                data-testid="input-email"
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">{t('auth.password')}</Label>
              <Input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={mode === 'register' ? t('auth.passwordPlaceholderRegister') : t('auth.passwordPlaceholderLogin')}
                className="bg-secondary/50 border-border text-sm h-10"
                dir="ltr"
                data-testid="input-password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={mode === 'register' ? 8 : 6}
              />
              {mode === 'register' && password.length > 0 && (
                <div className="space-y-1 mt-2">
                  {[
                    { test: password.length >= 8, label: t('auth.passwordRules.minLength') },
                    { test: /[A-Z]/.test(password), label: t('auth.passwordRules.uppercase') },
                    { test: /[a-z]/.test(password), label: t('auth.passwordRules.lowercase') },
                    { test: /[^A-Za-z0-9]/.test(password), label: t('auth.passwordRules.special') },
                  ].map((r, i) => (
                    <p key={i} className={`text-[11px] flex items-center gap-1.5 ${r.test ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${r.test ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                      {r.label}
                    </p>
                  ))}
                </div>
              )}
            </div>

            {turnstileEnabled && turnstileSiteKey && (
              <TurnstileWidget
                siteKey={turnstileSiteKey}
                onVerify={handleTurnstileVerify}
                onExpire={handleTurnstileExpire}
                onError={handleTurnstileError}
                resetKey={turnstileResetKey}
              />
            )}

            {error && (
              <p className="text-sm text-red-500 bg-red-500/10 rounded-md px-3 py-2 border border-red-500/20" data-testid="text-error">{error}</p>
            )}

            <Button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white h-10 text-sm font-medium"
              disabled={isLoading || !turnstileReady}
              data-testid="button-submit"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === 'login' ? t('auth.loginBtn') : t('auth.registerBtn')}
            </Button>

            {mode === 'login' && (
              <button
                type="button"
                onClick={() => { setMode('forgot'); setError(''); resetTurnstile(); }}
                className="w-full text-center text-xs text-muted-foreground hover:text-indigo-400 transition-colors mt-2"
                data-testid="button-forgot-password"
              >
                {t('auth.forgotPassword')}
              </button>
            )}
          </form>

          {googleConfig?.enabled && (
            <>
              <div className="flex items-center gap-3 my-4">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">{t('auth.orContinueWith')}</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="flex justify-center" ref={googleBtnRef} data-testid="google-signin" />
            </>
          )}

        </div>
      </div>
    </div>
  );
}
