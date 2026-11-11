import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { create } from 'zustand';

export type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastState {
  toasts: ToastItem[];
  push: (tone: ToastTone, message: string) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;

const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (tone, message) => {
    const id = nextId++;
    set((state) => {
      const toasts = [...state.toasts, { id, tone, message }].slice(-4);
      return { toasts };
    });
    window.setTimeout(
      () => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })),
      tone === 'error' ? 8000 : 4500,
    );
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })),
}));

/** Imperative notification API; renders through <ToastViewport />. */
export const toast = {
  success: (message: string) => useToastStore.getState().push('success', message),
  error: (message: string) => useToastStore.getState().push('error', message),
  info: (message: string) => useToastStore.getState().push('info', message),
  dismiss: (id: number) => useToastStore.getState().dismiss(id),
};

const TONE = {
  success: { color: 'var(--color-signal-up)', Icon: CheckCircle2 },
  error: { color: 'var(--color-signal-down)', Icon: XCircle },
  info: { color: 'var(--color-signal-info)', Icon: Info },
} as const;

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const { color, Icon } = TONE[item.tone];
  return (
    <div
      role={item.tone === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto flex w-80 items-start gap-2.5 rounded-[3px] border px-3 py-2.5 text-[12.5px] leading-[1.5] shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
      style={{
        borderColor: `color-mix(in oklab, ${color} 45%, transparent)`,
        background: 'var(--color-panel)',
        color: 'var(--color-ink)',
      }}
    >
      <Icon size={15} aria-hidden className="mt-0.5 shrink-0" style={{ color }} />
      <span className="min-w-0 flex-1 break-words">{item.message}</span>
      <button
        type="button"
        aria-label="Dismiss notification"
        className="shrink-0 rounded-[2px] p-0.5 hover:bg-[var(--color-panel-raised)]"
        style={{ color: 'var(--color-ink-faint)' }}
        onClick={onDismiss}
      >
        <X size={13} aria-hidden />
      </button>
    </div>
  );
}

/** Fixed stack of transient notifications, bottom right above the status bar. */
export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);
  if (toasts.length === 0) return null;
  return (
    <section
      aria-label="Notifications"
      className="pointer-events-none fixed right-3 bottom-9 z-[70] flex flex-col-reverse gap-2"
    >
      {toasts.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
      ))}
    </section>
  );
}
