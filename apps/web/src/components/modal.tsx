"use client";

import { useEffect, useId, useRef } from "react";

/**
 * The one dialog shell in the console. Every modal — confirmations, renames —
 * renders through this, so they share a backdrop, an escape hatch, and a focus
 * jump into the first field. Nothing here is a browser `prompt()`: the console
 * keeps its own typography even when it is asking a question.
 */
export function Modal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("input, textarea, select, button")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close.current();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgb(0 0 0 / 0.82)" }}
      // mousedown, not click: a drag that starts inside the panel and ends on
      // the backdrop is a text selection, not a dismissal.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="panel panel-ticks w-full max-w-md p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
      >
        <h2 id={headingId} className="title text-base">
          {title}
        </h2>
        {description && (
          <p className="mt-2 text-sm" style={{ color: "var(--ink-dim)" }}>
            {description}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}

/** The buttons every dialog ends with, in the order every dialog uses. */
export function ModalActions({
  confirmLabel,
  onCancel,
  disabled,
  className = "btn btn-primary",
}: {
  confirmLabel: string;
  onCancel: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" className="btn" onClick={onCancel}>
        Cancel
      </button>
      <button type="submit" className={className} disabled={disabled}>
        {confirmLabel}
      </button>
    </div>
  );
}
