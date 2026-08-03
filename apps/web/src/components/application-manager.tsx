"use client";

import type { ApplicationSummary } from "@cerebro/contracts";
import Link from "next/link";
import { useState, useTransition } from "react";
import { createApplication, deleteApplication, updateApplication } from "@/app/(app)/admin-actions";
import type { ActionResult } from "@/app/(app)/flags-actions";
import { ConfirmAction } from "@/components/confirm-action";

export function ApplicationManager({ applications }: { applications: ApplicationSummary[] }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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

              <button
                className="btn"
                type="button"
                disabled={pending}
                onClick={() => {
                  const name = window.prompt("New name", app.name);
                  if (!name || name === app.name) return;
                  startTransition(async () => report(await updateApplication(app.key, { name })));
                }}
              >
                Rename
              </button>

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
