"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/app/(app)/flags-actions";

/**
 * A button that runs a server action.
 *
 * When `confirmWith` is set — which the dashboard does for every write to a
 * protected environment (spec §10) — the exact text must be typed first.
 */
export function ConfirmAction({
  label,
  pendingLabel,
  onConfirm,
  onResult,
  confirmWith,
  title,
  description,
  disabled,
  disabledReason,
  className = "btn",
}: {
  label: string;
  pendingLabel?: string;
  onConfirm: () => Promise<ActionResult>;
  onResult?: (result: ActionResult) => void;
  confirmWith?: string | null;
  title?: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function run() {
    startTransition(async () => {
      const result = await onConfirm();
      onResult?.(result);
      setOpen(false);
      setTyped("");
    });
  }

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled || pending}
        title={disabled ? disabledReason : undefined}
        aria-describedby={disabled && disabledReason ? `${label}-reason` : undefined}
        onClick={() => (confirmWith ? setOpen(true) : run())}
      >
        {pending ? (pendingLabel ?? "Working…") : label}
      </button>

      {disabled && disabledReason && (
        <span id={`${label}-reason`} className="sr-only">
          {disabledReason}
        </span>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "rgb(0 0 0 / 0.82)" }}
          role="dialog"
          aria-modal="true"
          aria-label={title ?? label}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        >
          <div className="panel panel-ticks w-full max-w-md p-6">
            <h2 className="title text-base">{title ?? label}</h2>
            {description && (
              <p className="mt-2 text-sm" style={{ color: "var(--ink-dim)" }}>
                {description}
              </p>
            )}

            <label className="mt-4 flex flex-col gap-2">
              <span className="text-sm" style={{ color: "var(--ink-dim)" }}>
                Type <code className="hud text-[13px]" style={{ color: "var(--signal)" }}>{confirmWith}</code> to continue
              </span>
              <input
                ref={inputRef}
                className="field"
                value={typed}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => setTyped(event.target.value)}
              />
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={typed !== confirmWith || pending}
                onClick={run}
              >
                {pending ? (pendingLabel ?? "Working…") : label}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
