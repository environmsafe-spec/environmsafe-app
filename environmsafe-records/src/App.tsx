import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner, ToastProvider } from './components/ui';
import { AuthProvider, useAuth } from './lib/auth';
import { useSettings } from './lib/domain';
import { onAppResume } from './lib/native';
import { ChangePasswordScreen, LockScreen, LoginScreen, MfaEnrollScreen, MfaVerifyScreen } from './pages/AuthScreens';
import { Dashboard } from './pages/Dashboard';

const SearchPage = lazy(() => import('./pages/SearchPage'));
const SyncPage = lazy(() => import('./pages/SyncPage'));
const Clients = lazy(() => import('./pages/Clients'));
const Assets = lazy(() => import('./pages/Assets'));
const AssetDetail = lazy(() => import('./pages/AssetDetail'));
const Inspections = lazy(() => import('./pages/Inspections'));
const InspectionWizard = lazy(() => import('./pages/InspectionWizard'));
const Findings = lazy(() => import('./pages/Findings'));
const Jobs = lazy(() => import('./pages/Jobs'));
const DprForm = lazy(() => import('./pages/DprForm'));
const CertificatePage = lazy(() => import('./pages/CertificatePage'));
const Reports = lazy(() => import('./pages/Reports'));
const DueBoard = lazy(() => import('./pages/DueBoard'));
const Library = lazy(() => import('./pages/Library'));
const Users = lazy(() => import('./pages/Users'));
const Settings = lazy(() => import('./pages/Settings'));
const ImportPage = lazy(() => import('./pages/ImportPage'));
const Scan = lazy(() => import('./pages/Scan'));
const QuickPhoto = lazy(() => import('./pages/QuickPhoto'));
const More = lazy(() => import('./pages/More'));
const Help = lazy(() => import('./pages/Help'));
const Labels = lazy(() => import('./pages/Labels'));

function Loading() {
  return (
    <div className="flex justify-center py-16 text-navy dark:text-white">
      <Spinner size={32} />
    </div>
  );
}

function AssetRedirect() {
  const { id } = useParams();
  return <Navigate to={`/assets/${id}`} replace />;
}

function RequireRole({ ok, children }: { ok: boolean; children: ReactNode }) {
  return ok ? <>{children}</> : <Navigate to="/" replace />;
}

/** Locks the app after a period without use, and when it comes back to the foreground. */
function useIdleLock(minutes: number) {
  const [locked, setLocked] = useState(false);
  const last = useRef(Date.now());
  useEffect(() => {
    const touch = () => {
      last.current = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const check = () => {
      if (Date.now() - last.current > minutes * 60_000) setLocked(true);
    };
    const iv = setInterval(check, 15_000);
    const vis = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', vis);
    void onAppResume(check);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(iv);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [minutes]);
  const unlock = useCallback(() => {
    last.current = Date.now();
    setLocked(false);
  }, []);
  return { locked, unlock };
}

function ReadyApp() {
  const { can } = useAuth();
  const settings = useSettings();
  const { locked, unlock } = useIdleLock(settings?.options?.session_timeout_min ?? 30);
  if (locked) return <LockScreen onUnlock={unlock} />;
  const s = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="search" element={s(<SearchPage />)} />
        <Route path="sync" element={s(<SyncPage />)} />
        <Route path="clients/*" element={s(<Clients />)} />
        <Route path="assets" element={s(<Assets />)} />
        <Route path="assets/new" element={s(<Assets mode="new" />)} />
        <Route path="assets/:id/edit" element={s(<Assets mode="edit" />)} />
        <Route path="assets/:id" element={s(<AssetDetail />)} />
        <Route path="a/:id" element={<AssetRedirect />} />
        <Route path="inspections" element={s(<Inspections />)} />
        <Route path="inspections/new" element={s(<InspectionWizard />)} />
        <Route path="inspections/:id" element={s(<InspectionWizard />)} />
        <Route path="findings/*" element={s(<Findings />)} />
        <Route path="jobs/*" element={s(<Jobs />)} />
        <Route path="dprs/new" element={s(<DprForm />)} />
        <Route path="dprs/:id" element={s(<DprForm />)} />
        <Route path="certificates/new" element={s(<CertificatePage />)} />
        <Route path="certificates/:id" element={s(<CertificatePage />)} />
        <Route path="reports/*" element={s(<Reports />)} />
        <Route path="due" element={s(<DueBoard />)} />
        <Route path="library/*" element={s(<RequireRole ok={can.admin}><Library /></RequireRole>)} />
        <Route path="users" element={s(<RequireRole ok={can.admin}><Users /></RequireRole>)} />
        <Route path="settings/*" element={s(<Settings />)} />
        <Route path="import" element={s(<RequireRole ok={can.office}><ImportPage /></RequireRole>)} />
        <Route path="scan" element={s(<Scan />)} />
        <Route path="photo" element={s(<QuickPhoto />)} />
        <Route path="more" element={s(<More />)} />
        <Route path="help" element={s(<Help />)} />
        <Route path="labels" element={s(<Labels />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function Gate() {
  const { status } = useAuth();
  switch (status) {
    case 'loading':
      return <div className="flex min-h-full items-center justify-center bg-navy text-white"><Spinner size={36} /></div>;
    case 'signed_out':
      return <LoginScreen />;
    case 'mfa_verify':
      return <MfaVerifyScreen />;
    case 'mfa_enroll':
      return <MfaEnrollScreen />;
    case 'change_password':
      return <ChangePasswordScreen />;
    default:
      return <ReadyApp />;
  }
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
