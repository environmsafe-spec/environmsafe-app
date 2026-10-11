import {
  createContext, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';

type Tone = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';

const BTN: Record<Tone, string> = {
  primary: 'bg-navy text-white hover:bg-navy-700 dark:bg-accent dark:text-navy dark:hover:bg-accent-600',
  accent: 'bg-accent text-navy hover:bg-accent-600 font-bold',
  secondary: 'surface border-2 border-line hover:border-navy dark:hover:border-accent',
  ghost: 'hover:bg-black/5 dark:hover:bg-white/10',
  danger: 'bg-red-700 text-white hover:bg-red-800',
};

export function Button({
  tone = 'primary', icon, children, className = '', busy, size = 'md', ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; icon?: string; busy?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'sm' ? 'min-h-10 px-3 text-sm' : size === 'lg' ? 'min-h-14 px-5 text-lg' : 'min-h-12 px-4';
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:opacity-50 ${sz} ${BTN[tone]} ${className}`}
    >
      {busy ? <Spinner /> : icon ? <Icon name={icon} size={20} /> : null}
      {children}
    </button>
  );
}

export function LinkButton({ to, tone = 'primary', icon, children, className = '' }: { to: string; tone?: Tone; icon?: string; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 font-semibold transition ${BTN[tone]} ${className}`}>
      {icon && <Icon name={icon} size={20} />}
      {children}
    </Link>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.25" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" fill="none" />
    </svg>
  );
}

export function Field({ label, hint, error, children, className = '' }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      {children(id)}
      {hint && !error && <div className="text-muted text-xs">{hint}</div>}
      {error && <div className="text-sm font-semibold text-red-700 dark:text-red-400" role="alert">{error}</div>}
    </div>
  );
}

export function TextInput({ label, hint, error, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string | null }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id) => <input id={id} className="input" {...rest} />}
    </Field>
  );
}

export function TextArea({ label, hint, error, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: ReactNode; error?: string | null }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id) => <textarea id={id} className="input" {...rest} />}
    </Field>
  );
}

export function SelectInput({
  label, hint, error, options, placeholder, className, ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: ReactNode; error?: string | null; options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id) => (
        <select id={id} className="input" {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function Card({ children, className = '', title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={`surface rounded-2xl border border-line p-4 shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-lg font-bold">{title}</h2>}
          {actions && <div className="flex gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

const BADGE: Record<string, string> = {
  gray: 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100',
  navy: 'bg-navy text-white',
  accent: 'bg-accent text-navy',
  red: 'bg-red-700 text-white',
  amber: 'bg-amber-300 text-amber-950',
  green: 'bg-green-700 text-white',
  blue: 'bg-blue-700 text-white',
};

export function Badge({ children, tone = 'gray', className = '' }: { children: ReactNode; tone?: keyof typeof BADGE; className?: string }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${BADGE[tone]} ${className}`}>{children}</span>;
}

export function priorityTone(p: string): keyof typeof BADGE {
  return p === 'P1' ? 'red' : p === 'P2' ? 'amber' : 'blue';
}

export function statusTone(s: string): keyof typeof BADGE {
  if (s === 'issued' || s === 'closed' || s === 'fit') return 'green';
  if (s === 'draft') return 'gray';
  if (s === 'submitted' || s === 'reviewed') return 'blue';
  if (s === 'open_deteriorated' || s === 'not_fit') return 'red';
  if (s.startsWith('open') || s === 'deferred' || s === 'fit_conditions') return 'amber';
  return 'gray';
}

export function Empty({ title, children, icon = 'box' }: { title: string; children?: ReactNode; icon?: string }) {
  return (
    <div className="text-muted flex flex-col items-center gap-2 py-10 text-center">
      <Icon name={icon} size={36} />
      <div className="font-semibold">{title}</div>
      {children}
    </div>
  );
}

export function PageHeader({ title, sub, back, actions }: { title: ReactNode; sub?: ReactNode; back?: boolean | string; actions?: ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        {back && (
          <button
            type="button"
            aria-label="Back"
            onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))}
            className="-ms-2 mt-0.5 rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/10"
          >
            <Icon name="chevronLeft" className="rtl:rotate-180" />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold break-words text-navy dark:text-white">{title}</h1>
          {sub && <div className="text-muted mt-0.5">{sub}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Row({ to, title, sub, right, onClick }: { to?: string; title: ReactNode; sub?: ReactNode; right?: ReactNode; onClick?: () => void }) {
  const inner = (
    <>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{title}</div>
        {sub && <div className="text-muted truncate text-sm">{sub}</div>}
      </div>
      {right}
      {(to || onClick) && <Icon name="chevronRight" size={18} className="text-muted shrink-0 rtl:rotate-180" />}
    </>
  );
  const cls = 'flex min-h-14 w-full items-center gap-3 border-b border-line px-1 py-2 text-start last:border-b-0 hover:bg-black/[0.03] dark:hover:bg-white/5';
  if (to) return <Link to={to} className={cls}>{inner}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{inner}</button>;
  return <div className={cls}>{inner}</div>;
}

export function Tabs({ tabs, value, onChange }: { tabs: { key: string; label: string; count?: number }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div role="tablist" className="-mx-1 mb-4 flex gap-1 overflow-x-auto pb-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          type="button"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={`min-h-11 shrink-0 rounded-xl px-3.5 text-sm font-semibold ${value === t.key ? 'bg-navy text-white dark:bg-accent dark:text-navy' : 'surface border border-line'}`}
        >
          {t.label}
          {t.count != null && <span className="ms-1.5 opacity-75">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className={`surface m-auto w-[calc(100%-1.5rem)] rounded-2xl border border-line p-0 text-[var(--text)] shadow-2xl backdrop:bg-black/50 ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-lg font-bold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/10">
              <Icon name="x" />
            </button>
          </div>
          <div className="overflow-y-auto p-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
interface ToastMsg { id: number; text: string; tone: 'ok' | 'error' }
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'error') => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastMsg[]>([]);
  const push = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
        {items.map((t) => (
          <div key={t.id} className={`pointer-events-auto max-w-md rounded-xl px-4 py-3 font-semibold shadow-lg ${t.tone === 'error' ? 'bg-red-700 text-white' : 'bg-navy text-white'}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Stat({ label, value, tone = 'navy', to }: { label: string; value: ReactNode; tone?: 'navy' | 'red' | 'amber' | 'green'; to?: string }) {
  const color = tone === 'red' ? 'text-red-700 dark:text-red-400' : tone === 'amber' ? 'text-amber-700 dark:text-amber-300' : tone === 'green' ? 'text-green-700 dark:text-green-400' : 'text-navy dark:text-white';
  const body = (
    <div className="surface h-full rounded-2xl border border-line p-4">
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
      <div className="text-muted mt-1 text-sm font-semibold">{label}</div>
    </div>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

export function Checkbox({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3">
      <input type="checkbox" className="h-5 w-5 accent-[var(--color-accent)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-11 rounded-xl border-2 px-3 text-sm font-bold ${value === o.value ? 'border-navy bg-navy text-white dark:border-accent dark:bg-accent dark:text-navy' : 'surface border-line'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function confirmAction(message: string): boolean {
  return window.confirm(message);
}
