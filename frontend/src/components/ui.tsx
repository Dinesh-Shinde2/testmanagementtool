import { useEffect, useState } from "react";
import type { ExecStatus } from "../types";

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PASS: "bg-green-50 text-good",
    FAIL: "bg-red-50 text-bad",
    BLOCKED: "bg-amber-50 text-warn",
    SKIPPED: "bg-slate-100 text-mute",
    NOT_EXECUTED: "bg-slate-50 text-idle",
    NOT_MAPPED_TO_RUN: "bg-slate-50 text-idle",
    ACTIVE: "bg-green-50 text-good",
    PLANNED: "bg-brand-soft text-brand",
    CLOSED: "bg-slate-100 text-mute",
    READY: "bg-green-50 text-good",
    READY_FOR_EXECUTE: "bg-brand-soft text-brand",
    DRAFT: "bg-amber-50 text-warn",
    IN_PROGRESS: "bg-brand-soft text-brand",
    COMPLETED: "bg-green-50 text-good",
    DEPRECATED: "bg-slate-100 text-mute",
    OPEN: "bg-red-50 text-bad",
    FIXED: "bg-amber-50 text-warn",
    AWAITING_RETEST: "bg-amber-50 text-warn",
    PASSED_AFTER_RETEST: "bg-green-50 text-good",
    RETEST_FAILED: "bg-red-50 text-bad",
    HIGH: "bg-red-50 text-bad",
    MEDIUM: "bg-amber-50 text-warn",
    LOW: "bg-slate-100 text-mute",
    CRITICAL: "bg-red-50 text-bad",
    ADMIN: "bg-brand-soft text-brand",
    QA: "bg-green-50 text-good",
    VIEWER: "bg-slate-100 text-mute",
    COVERED: "bg-green-50 text-good",
    NOT_COVERED: "bg-red-50 text-bad",
  };
  const labels: Record<string, string> = {
    COVERED: "Covered",
    NOT_COVERED: "Not Covered",
    AWAITING_RETEST: "Awaiting retest",
    PASSED_AFTER_RETEST: "Passed after retest",
    RETEST_FAILED: "Retest failed",
    OPEN: "Open",
    FIXED: "Fixed",
    CLOSED: "Closed",
  };
  const label = labels[status] || status.replaceAll("_", " ");
  return (
    <span
      className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium tracking-wide ${labels[status] ? "" : "uppercase"} ${map[status] || "bg-slate-100 text-mute"}`}
    >
      {label}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-mute">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" onClick={onClose} role="presentation">
      <div
        className={`w-full rounded-xl border border-line bg-white shadow-[0_16px_48px_rgba(16,24,40,0.18)] ${wide === false ? "max-w-md" : wide ? "max-w-2xl" : "max-w-lg"}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button className="rounded-md px-2 py-1 text-sm text-mute hover:bg-slate-50 hover:text-ink" onClick={onClose} type="button">
            Close
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]" aria-busy="true" aria-live="polite">
      <div className="border-b border-line px-4 py-3">
        <div className="h-9 max-w-xs animate-pulse rounded-md bg-slate-100" />
      </div>
      <div>
        {Array.from({ length: rows }).map((_, row) => (
          <div key={row} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
            {Array.from({ length: cols }).map((_, col) => (
              <div
                key={col}
                className="h-3.5 flex-1 animate-pulse rounded bg-slate-100"
                style={{ maxWidth: col === 0 ? "4.5rem" : col === cols - 1 ? "5rem" : undefined, opacity: 1 - row * 0.06 }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-[4.5rem] animate-pulse rounded-2xl border border-line bg-white" />
      ))}
    </section>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  danger = true,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose} wide={false}>
      <p className="text-sm text-mute">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" type="button" disabled={busy} onClick={onClose}>
          {cancelLabel}
        </button>
        <button className={danger ? "btn-danger" : "btn-primary"} type="button" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function PromptDialog({
  title,
  label = "Name",
  initialValue = "",
  placeholder,
  confirmLabel = "Save",
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  label?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  function submit() {
    const next = value.trim();
    if (!next) return;
    onConfirm(next);
  }

  return (
    <Modal title={title} onClose={onClose} wide={false}>
      <label className="field">
        <span>{label}</span>
        <input
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" type="button" disabled={busy || !value.trim()} onClick={submit}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="card px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint ? <p className="mt-1 text-sm text-mute">{hint}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : "Something went wrong";
  return <p className="mb-3 text-sm text-bad">{message}</p>;
}

export const EXEC_OPTIONS: ExecStatus[] = ["PASS", "FAIL", "BLOCKED", "SKIPPED", "NOT_EXECUTED"];
