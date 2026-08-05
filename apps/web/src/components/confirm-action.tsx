"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/app/(app)/flags-actions";
import { Modal, ModalActions } from "@/components/modal";

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
        <Modal
          title={title ?? label}
          description={description}
          onClose={() => setOpen(false)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              run();
            }}
          >
            <label className="mt-4 flex flex-col gap-2">
              <span className="text-sm" style={{ color: "var(--ink-dim)" }}>
                Type <code className="hud text-[13px]" style={{ color: "var(--signal)" }}>{confirmWith}</code> to continue
              </span>
              <input
                className="field"
                value={typed}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => setTyped(event.target.value)}
              />
            </label>

            <ModalActions
              confirmLabel={pending ? (pendingLabel ?? "Working…") : label}
              onCancel={() => setOpen(false)}
              disabled={typed !== confirmWith || pending}
            />
          </form>
        </Modal>
      )}
    </>
  );
}
