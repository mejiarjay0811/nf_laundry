import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Lock, ShieldCheck, User } from 'lucide-react';
import type { Role } from '@shared/constants';
import type { HealthStatus } from '@shared/types';
import { landingPath } from '@/layouts/navigation';
import { useAuth } from '@/auth/AuthProvider';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/States';
import { api, errorMessage } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

function BrandPanel() {
  return (
    <div className="hidden flex-1 flex-col justify-between bg-navy-950 p-10 lg:flex">
      {/* The shop's own mark, not a drawn stand-in. This panel used to carry a
          hardcoded washing-machine icon, which is why the sign-in screen never
          picked up the logo everywhere else was using. */}
      <div className="flex items-center gap-3">
        <Logo compact size="lg" />
        <div>
          <p className="text-lg font-bold tracking-tight text-white">N &amp; F LAUNDRY</p>
          <p className="text-xs uppercase tracking-widest text-slate-400">Point of Sale</p>
        </div>
      </div>

      <div className="max-w-md">
        <h1 className="text-3xl font-bold leading-tight text-white">
          Run the shop from one screen.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          Take orders, track every load through washing and drying, settle balances, and see
          exactly what the shop earned today.
        </p>
        <ul className="mt-6 space-y-2.5 text-sm text-slate-300">
          {[
            'Sequential O.R. numbers, never duplicated',
            'Cash and GCash with partial payments',
            'Daily, weekly, monthly and yearly reporting',
          ].map((line) => (
            <li key={line} className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" aria-hidden="true" />
              {line}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-slate-500">
        {'\u00A9 '}
        {new Date().getFullYear()} N &amp; F Laundry. All rights reserved.
      </p>
    </div>
  );
}

function ConnectionStatus({ health }: { health: HealthStatus | undefined }) {
  return (
    <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-400">
      {health === undefined ? (
        <Spinner className="h-3 w-3 text-slate-400" />
      ) : (
        <span
          className={'h-2 w-2 rounded-full ' + (health.ok ? 'bg-emerald-400' : 'bg-amber-400')}
          aria-hidden="true"
        />
      )}
      {health === undefined
        ? 'Checking data connection\u2026'
        : health.ok
          ? 'Data connection healthy'
          : 'Data connection needs attention'}
    </p>
  );
}

export default function Login() {
  useDocumentTitle('Sign in');
  const { login, status, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [welcome, setWelcome] = useState<string | null>(null);

  // Surface a data-source problem before the cashier tries to sign in, so a
  // misconfigured spreadsheet does not look like a wrong password.
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => api.get<HealthStatus>('/system/health', undefined, signal),
    retry: false,
    staleTime: 30_000,
  });

  useEffect(() => {
    document.getElementById('username')?.focus();
  }, []);

  /**
   * Where to go after signing in. Falls back to the account's own landing
   * screen rather than the dashboard, which staff are not permitted to open.
   */
  const redirectTo = (role: Role) => {
    const from = (location.state as { from?: string } | null)?.from;
    return from && from !== '/login' ? from : landingPath(role);
  };

  if (user && status === 'authenticated' && !welcome) {
    return <Navigate to={redirectTo(user.role)} replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);
    try {
      const session = await login(username.trim(), password, remember);
      // Confirm who just signed in before moving, so the cashier sees the app
      // acknowledge them rather than the screen simply changing.
      setWelcome(session.fullName);
      // Matches the handoff animation, so the move happens as it finishes
      // rather than cutting it off part way.
      window.setTimeout(() => navigate(redirectTo(session.role), { replace: true }), 3000);
    } catch (caught) {
      setError(errorMessage(caught));
      setPassword('');
      setSubmitting(false);
    }
  };

  /*
   * The handover into the app: the mark settles, the name confirms who signed
   * in, then the whole panel zooms away as the app zooms in behind it. It is
   * also honest cover for real work — the first screen has data to fetch.
   */
  if (welcome) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-navy-900 via-navy-900 to-[#0b1220] px-6 text-center">
        <div className="splash-grid pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="handoff relative flex flex-col items-center">
          <span
            className="relative mb-5 flex h-28 w-28 items-center justify-center rounded-[28px] ring-1 ring-white/20"
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.12)',
              boxShadow:
                '0 0 0 1px rgba(255,255,255,0.06), 0 26px 55px -25px rgba(0,0,0,0.9), 0 0 80px -30px rgba(56,132,255,0.5)',
            }}
          >
            <span className="h-full w-full overflow-hidden rounded-[28px]">
              <img
                src="/logo.png"
                alt=""
                className="h-full w-full object-cover"
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                }}
              />
            </span>
            <span className="absolute -bottom-1.5 -right-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 ring-4 ring-navy-900">
              <CheckCircle2 className="h-5 w-5 text-white" aria-hidden="true" />
            </span>
          </span>
          <p className="text-xl font-bold text-white">Welcome back, {welcome.split(' ')[0]}</p>
          <p className="mt-1 text-sm text-slate-400">Opening the till…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-navy-900 lg:flex-row">
      <BrandPanel />

      <div className="flex flex-1 items-center justify-center p-5 sm:p-8">
        <div className="w-full max-w-sm">
          {/* On a phone the brand panel is hidden, so the mark goes here —
              otherwise the sign-in screen carries no logo at all. */}
          <div className="mb-6 flex flex-col items-center text-center lg:hidden">
            <Logo compact size="lg" className="mb-3" />
            <p className="text-xl font-bold text-white">N &amp; F LAUNDRY</p>
            <p className="text-xs uppercase tracking-widest text-slate-400">Point of Sale</p>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-pop sm:p-7">
            <h2 className="text-lg font-bold text-navy-900">Sign in</h2>
            <p className="mt-1 text-sm text-slate-600">Enter your staff credentials to continue.</p>

            {health && !health.ok ? (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-600/20"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{health.message}</span>
              </div>
            ) : null}

            <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate>
              <Input
                id="username"
                name="username"
                label="Username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                leading={<User className="h-4 w-4" aria-hidden="true" />}
                required
              />

              <Input
                id="password"
                name="password"
                label="Password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                leading={<Lock className="h-4 w-4" aria-hidden="true" />}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="rounded p-0.5 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                }
                required
              />

              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                Keep me signed in on this device
              </label>

              {error ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-600/20"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              ) : null}

              <Button type="submit" size="lg" fullWidth loading={submitting}>
                {submitting ? 'Signing in\u2026' : 'Sign in'}
              </Button>
            </form>
          </div>

          <ConnectionStatus health={health} />
        </div>
      </div>
    </div>
  );
}
