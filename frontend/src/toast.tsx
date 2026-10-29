import { CheckCircle2, X } from "lucide-react";
import { useSyncExternalStore } from "react";

type ToastTone = "good" | "bad" | "ink";

type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
  actionLabel?: string;
  onAction?: () => void;
};

type ToastOptions = {
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number;
};

type ToastApi = {
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
};

/** Module store — survives context/HMR identity issues that left the toast tray empty. */
let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot() {
  return items;
}

function dismiss(id: number) {
  items = items.filter((row) => row.id !== id);
  emit();
}

function push(message: string, tone: ToastTone, options?: ToastOptions) {
  const id = ++seq;
  items = [
    ...items,
    {
      id,
      message,
      tone,
      actionLabel: options?.actionLabel,
      onAction: options?.onAction,
    },
  ];
  emit();
  window.setTimeout(() => dismiss(id), options?.durationMs ?? (options?.actionLabel ? 7000 : 3200));
}

const toastApi: ToastApi = {
  success: (message, options) => push(message, "good", options),
  error: (message, options) => push(message, "bad", options),
  info: (message, options) => push(message, "ink", options),
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const rows = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return (
    <>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[90] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
        {rows.map((item) => (
          <div
            key={item.id}
            className={`pointer-events-auto flex items-start gap-2 rounded-xl border bg-white px-3 py-2.5 text-sm shadow-[0_12px_32px_rgba(16,24,40,0.14)] ${
              item.tone === "good"
                ? "border-green-100 text-good"
                : item.tone === "bad"
                  ? "border-red-100 text-bad"
                  : "border-line text-ink"
            }`}
            role="status"
          >
            {item.tone === "good" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden /> : null}
            <span className="min-w-0 flex-1 font-medium leading-snug text-ink">{item.message}</span>
            {item.actionLabel && item.onAction ? (
              <button
                className="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold text-brand hover:bg-brand-soft"
                type="button"
                onClick={() => {
                  item.onAction?.();
                  dismiss(item.id);
                }}
              >
                {item.actionLabel}
              </button>
            ) : null}
            <button
              className="shrink-0 rounded p-0.5 text-mute hover:bg-slate-50 hover:text-ink"
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(item.id)}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

export function useToast(): ToastApi {
  return toastApi;
}

/** Direct access (same store as useToast). */
export const toast = toastApi;
