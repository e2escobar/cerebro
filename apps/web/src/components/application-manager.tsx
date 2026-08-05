"use client";

import type { ApplicationSummary } from "@cerebro/contracts";
import Link from "next/link";
import { useState, useTransition } from "react";
import { createApplication, deleteApplication, updateApplication } from "@/app/(app)/admin-actions";
import type { ActionResult } from "@/app/(app)/flags-actions";
import { ConfirmAction } from "@/components/confirm-action";
import { Modal, ModalActions } from "@/components/modal";

export function ApplicationManager({ applications }: { applications: ApplicationSummary[] }) {
  const [message, setMessage] = useState<string | null>(null);

  function report(result: ActionResult) {
    setMessage(result.ok ? null : result.message);
  }

  return (
    <>
      <section className="panel panel-ticks mt-6">
        <div className="stripe">
          {applications.length === 0 && (
            <p className="prose px-6 py-10 text-center text-sm" style={{ color: "var(--ink-dim)" }}>
              None yet. Create the first one below — flags have nowhere to live until you do.
            </p>
          )}
          {applications.map((app) => (
            <div key={app.key} className="flex flex-wrap items-center gap-4 px-5 py-4">
              <Link href={`/apps/${app.key}`} className="hud text-[15px]" style={{ color: "var(--signal)" }}>
                {app.key}
              </Link>
              <span className="text-[15px]">{app.name}</span>
              {app.description && (
                <span className="prose text-[13px]" style={{ color: "var(--ink-dim)" }}>
                  {app.description}
                </span>
              )}
              <span className="badge ml-auto">
                {app.flagCount} flag{app.flagCount === 1 ? "" : "s"}
              </span>

              <RenameApplication app={app} onResult={report} />

              <ConfirmAction
                label="Delete"
                className="btn btn-danger"
                confirmWith={app.key}
                title={`Delete ${app.key}`}
                description="Only possible once every flag here is archived. Its archived flags and API keys go with it."
                onConfirm={() => deleteApplication(app.key)}
                onResult={report}
              />
            </div>
          ))}
        </div>
      </section>

      {message && (
        <p role="alert" className="prose mt-4 text-sm" style={{ color: "var(--signal)" }}>
          {message}
        </p>
      )}

      <NewApplication onResult={report} />
    </>
  );
}

/**
 * The name is the only thing an application can change — the key is stamped
 * into every SDK key already issued for it, so it stays where it is.
 */
function RenameApplication({
  app,
  onResult,
}: {
  app: ApplicationSummary;
  onResult: (result: ActionResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(app.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await updateApplication(app.key, { name: name.trim() });
      onResult(result);
      if (result.ok) setOpen(false);
      else setError(result.message);
    });
  }

  return (
    <>
      <button
        className="btn"
        type="button"
        onClick={() => {
          setName(app.name);
          setError(null);
          setOpen(true);
        }}
      >
        Rename
      </button>

      {open && (
        <Modal title={`Rename ${app.key}`} onClose={() => setOpen(false)}>
          <p className="mt-2 text-sm" style={{ color: "var(--ink-dim)" }}>
            The key stays <code className="hud text-[13px]" style={{ color: "var(--signal)" }}>{app.key}</code> — it
            is what every SDK key for this application was issued against.
          </p>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <label className="mt-4 flex flex-col gap-2">
              <span className="text-sm" style={{ color: "var(--ink-dim)" }}>
                Name
              </span>
              <input
                className="field"
                value={name}
                required
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
              />
            </label>

            {error && (
              <p role="alert" className="mt-3 text-[13px]" style={{ color: "var(--signal)" }}>
                {error}
              </p>
            )}

            <ModalActions
              confirmLabel={pending ? "Saving…" : "Save"}
              onCancel={() => setOpen(false)}
              disabled={pending || name.trim() === "" || name.trim() === app.name}
            />
          </form>
        </Modal>
      )}
    </>
  );
}

function NewApplication({ onResult }: { onResult: (result: ActionResult) => void }) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <section className="panel panel-ticks mt-8 p-5">
      <h2 className="eyebrow">Add an application</h2>
      <p className="prose mt-2 text-[13px]" style={{ color: "var(--ink-dim)" }}>
        It starts empty, in every environment. The key is permanent — it appears in every SDK key
        issued for this application.
      </p>

      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await createApplication({ key, name, description });
            onResult(result);
            if (result.ok) {
              setKey("");
              setName("");
              setDescription("");
            }
          });
        }}
      >
        <label className="flex flex-col gap-2">
          <span className="eyebrow">Key</span>
          <input
            className="field hud w-44"
            value={key}
            required
            spellCheck={false}
            placeholder="checkout"
            pattern="[a-z][a-z0-9-]{1,31}"
            onChange={(event) => setKey(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="eyebrow">Name</span>
          <input
            className="field w-52"
            value={name}
            required
            placeholder="Checkout"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="eyebrow">Description</span>
          <input
            className="field w-64"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <button className="btn btn-primary mb-0.5" type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add application"}
        </button>
      </form>
    </section>
  );
}
