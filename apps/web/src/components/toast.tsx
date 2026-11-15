import { CheckCircleIcon, InfoIcon, CircleNotchIcon, XIcon, XCircleIcon  } from '@phosphor-icons/react';
import { create } from 'zustand';

export type ToastTone = 'success' | 'error' | 'info' | 'progress';

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
  /** 0–100 for progress toasts; they stay visible until settled. */
  progress: number | null;
}

interface ToastState {
  toasts: ToastItem[];
  push: (tone: ToastTone, message: string) => number;
  pushProgress: (message: string, progress: number | null) => number;
  update: (id: number, patch: { message?: string; progress?: number }) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

function expire(id: number, tone: ToastTone): void {
  if (tone === 'progress') return;
  window.setTimeout(
    () =>
      useToastStore.setState((state) => ({
        toasts: state.toasts.filter((item) => item.id !== id),
      })),
    tone === 'error' ? 8000 : 4500,
  );
}

const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (tone, message) => {
    const id = nextId++;
    set((state) => {
      const toasts = [...state.toasts, { id, tone, message, progress: null }].slice(-4);
      return { toasts };
    });
    expire(id, tone);
    return id;
  },
  pushProgress: (message, progress) => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { id, tone: 'progress', message, progress }] }));
    return id;
  },
  update: (id, patch) =>
    set((state) => ({
      toasts: state.toasts.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })),
}));

/** Imperative notification API; renders through <ToastViewport />. */
export const toast = {
  success: (message: string) => useToastStore.getState().push('success', message),
  error: (message: string) => useToastStore.getState().push('error', message),
  info: (message: string) => useToastStore.getState().push('info', message),
  /** Persistent toast with a spinner and progress bar; finish it with settle(). */
  progress: (message: string, progress: number | null = null) =>
    useToastStore.getState().pushProgress(message, progress),
  /** Update a progress toast's message and/or progress percentage. */
  update: (id: number, patch: { message?: string; progress?: number }) =>
    useToastStore.getState().update(id, patch),
  /** Replace a progress toast with a final success/error/info message. */
  settle: (id: number, tone: 'success' | 'error' | 'info', message: string) => {
    useToastStore.getState().update(id, { message });
    useToastStore.setState((state) => ({
      toasts: state.toasts.map((item) =>
        item.id === id ? { ...item, tone, progress: null } : item,
      ),
    }));
    expire(id, tone);
  },
  dismiss: (id: number) => useToastStore.getState().dismiss(id),
};

const TONE = {
  success: { color: 'var(--color-signal-up)', iconClass: 'text-signal-up', Icon: CheckCircleIcon },
  error: { color: 'var(--color-signal-down)', iconClass: 'text-signal-down', Icon: XCircleIcon },
  info: { color: 'var(--color-signal-info)', iconClass: 'text-signal-info', Icon: InfoIcon },
  progress: { color: 'var(--color-primary)', iconClass: 'text-primary', Icon: CircleNotchIcon },
} as const;

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const { color, iconClass, Icon } = TONE[item.tone];
  return (
    <div
      role={item.tone === 'error' ? 'alert' : 'status'}
      aria-live={item.tone === 'progress' ? 'off' : undefined}
      className="pointer-events-auto flex w-80 items-start gap-2.5 rounded-sm border bg-card px-3 py-2.5 text-[12.5px] leading-[1.5] text-card-foreground shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
      style={{
        borderColor: `color-mix(in oklab, ${color} 45%, transparent)`,
      }}
    >
      <Icon
        size={15}
        aria-hidden
        className={`mt-0.5 shrink-0 ${item.tone === 'progress' ? 'animate-spin' : ''} ${iconClass}`}
      />
      <span className="min-w-0 flex-1 break-words">
        {item.message}
        {item.progress !== null ? (
          <span
            className="mt-1.5 block h-1 overflow-hidden rounded-full bg-background"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(item.progress)}
          >
            <span
              className="block h-full rounded-full"
              style={{
                width: `${Math.max(2, Math.min(100, item.progress))}%`,
                background: color,
              }}
            />
          </span>
        ) : null}
      </span>
      <button
        type="button"
        aria-label="Dismiss notification"
        className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        onClick={onDismiss}
      >
        <XIcon size={13} aria-hidden />
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
