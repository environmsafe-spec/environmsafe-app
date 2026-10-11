import { useEffect, useRef, useState, type ReactNode } from 'react';
import { biometricEnabled, hasPin, verifyPin } from '../lib/applock';
import { PASSWORD_RULES, passwordProblem, useAuth } from '../lib/auth';
import { biometricUnlock, isNative } from '../lib/native';
import { configured, supabase } from '../lib/supabase';
import { Button, TextInput } from '../components/ui';

function Shell({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-navy p-4">
      <div className="surface w-full max-w-md rounded-3xl p-6 shadow-2xl">
        <div className="mb-5 flex flex-col items-center gap-3 text-center">
          <img src="/logo-login.webp" alt="EnvironmSafe" width="99" height="96" className="h-24 w-auto" />
          <div className="h-1 w-16 rounded bg-accent" />
          <h1 className="text-xl font-bold text-navy dark:text-white">{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

export function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!configured) {
    return (
      <Shell title="EnvironmSafe Records">
        <p className="text-center">This copy of the app has not been connected to its database yet.</p>
      </Shell>
    );
  }
  return (
    <Shell title="EnvironmSafe Records">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(await signIn(email, password));
          setBusy(false);
        }}
      >
        <TextInput label="E-mail" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextInput label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} error={error} />
        <Button type="submit" size="lg" busy={busy}>Sign in</Button>
        <p className="text-muted text-center text-sm">Forgot your password? Ask your administrator to reset it.</p>
      </form>
    </Shell>
  );
}

export function MfaVerifyScreen() {
  const { refresh, signOut } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Shell title="Two-step sign-in">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const { data } = await supabase.auth.mfa.listFactors();
          const f = data?.totp?.[0];
          if (!f) {
            setError('No authenticator is set up for this account.');
            setBusy(false);
            return;
          }
          const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: f.id, code: code.trim() });
          if (err) setError('That code is not right. Check the time on your phone and try again.');
          else await refresh();
          setBusy(false);
        }}
      >
        <p>Open your authenticator app and type the 6-digit code for EnvironmSafe Records.</p>
        <TextInput label="6-digit code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} error={error} />
        <Button type="submit" size="lg" busy={busy}>Verify</Button>
        <Button tone="ghost" onClick={() => signOut(true)}>Cancel and sign out</Button>
      </form>
    </Shell>
  );
}

export function MfaEnrollScreen({ required = true, onDone }: { required?: boolean; onDone?: () => void }) {
  const { refresh, signOut } = useAuth();
  const [factor, setFactor] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const { data: list } = await supabase.auth.mfa.listFactors();
      for (const f of list?.all ?? []) {
        if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `ES Records ${new Date().toISOString().slice(0, 10)}` });
      if (err || !data) setError(err?.message ?? 'Could not start set-up.');
      else setFactor({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    })();
  }, []);
  const body = (
    <div className="flex flex-col gap-4">
      {required && <p><b>Admin accounts must use two-step sign-in.</b> This protects your company data if your password is ever stolen.</p>}
      <ol className="list-decimal space-y-1 ps-5">
        <li>Install a free authenticator app on your phone (Google Authenticator or Microsoft Authenticator).</li>
        <li>In the app, tap <b>+</b> and scan this QR code.</li>
        <li>Type the 6-digit code the app shows.</li>
      </ol>
      {factor ? (
        <>
          <img src={factor.qr} alt="QR code for the authenticator app" className="mx-auto h-48 w-48 rounded-lg bg-white p-2" />
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold">Can't scan? Type this key instead</summary>
            <code className="mt-1 block break-all rounded bg-black/5 p-2 dark:bg-white/10">{factor.secret}</code>
          </details>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
              if (err) setError('That code is not right. Try the newest code.');
              else {
                await supabase.rpc('log_event', { p_action: 'mfa_enrolled', p_details: {} });
                if (onDone) onDone();
                else await refresh();
              }
              setBusy(false);
            }}
          >
            <TextInput label="6-digit code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} error={error} />
            <Button type="submit" size="lg" busy={busy}>Turn on two-step sign-in</Button>
          </form>
        </>
      ) : (
        <p className="text-muted">{error ?? 'Preparing…'}</p>
      )}
      {required && <Button tone="ghost" onClick={() => signOut(true)}>Sign out</Button>}
    </div>
  );
  return required ? <Shell title="Set up two-step sign-in">{body}</Shell> : body;
}

export function ChangePasswordForm({ onDone, email }: { onDone: () => void; email?: string }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const p = passwordProblem(pw, email);
        if (p) return setError(p);
        if (pw !== pw2) return setError('The two passwords are different.');
        setBusy(true);
        const { error: err } = await supabase.auth.updateUser({ password: pw });
        if (err) {
          setError(err.message);
          setBusy(false);
          return;
        }
        const { data } = await supabase.auth.getUser();
        if (data.user) await supabase.from('profiles').update({ must_change_password: false }).eq('id', data.user.id);
        await supabase.rpc('log_event', { p_action: 'password_changed', p_details: {} });
        setBusy(false);
        onDone();
      }}
    >
      <TextInput label="New password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} hint={PASSWORD_RULES} />
      <TextInput label="Repeat new password" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} error={error} />
      <Button type="submit" size="lg" busy={busy}>Save new password</Button>
    </form>
  );
}

export function ChangePasswordScreen() {
  const { refresh, profile } = useAuth();
  return (
    <Shell title="Choose your own password">
      <p className="mb-4">You signed in with a temporary password. Please choose a new one now.</p>
      <ChangePasswordForm email={profile?.email} onDone={() => void refresh()} />
    </Shell>
  );
}

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { profile, signOut } = useAuth();
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pinMode = hasPin();
  useEffect(() => {
    if (pinMode && isNative && biometricEnabled()) {
      void biometricUnlock().then((ok) => ok && onUnlock());
    }
  }, [pinMode, onUnlock]);
  return (
    <Shell title="App locked">
      <p className="mb-4 text-center">Signed in as <b>{profile?.full_name || profile?.email}</b></p>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (pinMode) {
            if (await verifyPin(pin)) onUnlock();
            else {
              setError('Wrong PIN.');
              setPin('');
            }
          } else {
            const { error: err } = await supabase.auth.signInWithPassword({ email: profile?.email ?? '', password });
            if (err) setError(navigator.onLine ? 'Wrong password.' : 'You are offline. Set an app PIN in Settings so you can unlock offline.');
            else onUnlock();
          }
        }}
      >
        {pinMode ? (
          <TextInput label="PIN" type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} error={error} />
        ) : (
          <TextInput label="Password" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} error={error} />
        )}
        <Button type="submit" size="lg">Unlock</Button>
        {pinMode && isNative && biometricEnabled() && (
          <Button tone="secondary" onClick={() => void biometricUnlock().then((ok) => ok && onUnlock())}>Use fingerprint</Button>
        )}
        <Button tone="ghost" onClick={async () => {
          const msg = await signOut();
          if (msg) setError(msg);
        }}>Sign out</Button>
      </form>
    </Shell>
  );
}
