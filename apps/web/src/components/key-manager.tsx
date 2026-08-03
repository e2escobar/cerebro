"use client";

import type {
  ApiKeySummary,
  ApplicationSummary,
  CreatedApiKey,
  EnvironmentSummary,
} from "@cerebro/contracts";
import { useState, useTransition } from "react";
import { createApiKey, revokeApiKey } from "@/app/(app)/admin-actions";
import { ConfirmAction } from "@/components/confirm-action";
import { envColor } from "@/lib/env-color";

export function KeyManager({
  applications,
  environments,
  keys,
}: {
  applications: ApplicationSummary[];
  environments: EnvironmentSummary[];
  keys: ApiKeySummary[];
}) {
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const rankByKey = new Map(environments.map((e, index) => [e.key, index]));

  return (
    <>
      <NewKey
        applications={applications}
        environments={environments}
        onCreated={(key) => {
          setCreated(key);
          setMessage(null);
        }}
        onError={setMessage}
      />

      {created && <RevealOnce created={created} onDismiss={() => setCreated(null)} />}

      {message && (
        <p role="alert" className="mt-4 text-sm" style={{ color: "var(--signal)" }}>
          {message}
        </p>
      )}

      {environments.map((env) => {
        const forEnv = keys.filter((key) => key.environmentKey === env.key);
        const color = envColor(rankByKey.get(env.key) ?? 0, environments.length);

        return (
          <section key={env.key} className="mt-8">
            <h2 className="eyebrow" style={{ color }}>
              {env.key}
            </h2>

            {forEnv.length === 0 ? (
              <p className="panel prose mt-3 p-5 text-[13px]" style={{ color: "var(--ink-dim)" }}>
                No keys for {env.key} yet.
              </p>
            ) : (
              <ul className="panel stripe mt-3">
                {forEnv.map((key) => (
                  <li
                    key={key.id}
                    className="flex flex-wrap items-center gap-3 px-5 py-3.5"
                    style={key.revokedAt ? { opacity: 0.5 } : undefined}
                  >
                    <code className="hud text-[13px]">{key.prefix}…</code>
                    <span className="badge">{key.applicationKey}</span>
                    <span className="text-sm">{key.name}</span>
                    <span className={`badge ${key.kind === "client" ? "badge-protected" : ""}`}>
                      {key.kind}
                    </span>
                    <span className="text-xs" style={{ color: "var(--ink-dim)" }}>
                      {key.revokedAt
                        ? `revoked ${new Date(key.revokedAt).toLocaleDateString()}`
                        : key.lastUsedAt
                          ? `last used ${new Date(key.lastUsedAt).toLocaleString()}`
                          : "never used"}
                    </span>

                    {!key.revokedAt && (
                      <ConfirmAction
                        label="Revoke"
                        className="btn btn-danger ml-auto"
                        confirmWith={key.prefix}
                        title={`Revoke ${key.prefix}…`}
                        description="Anything using this key stops receiving flags immediately. This cannot be undone."
                        onConfirm={() => revokeApiKey(key.id)}
                        onResult={(result) => setMessage(result.ok ? null : result.message)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}

function NewKey({
  applications,
  environments,
  onCreated,
  onError,
}: {
  applications: ApplicationSummary[];
  environments: EnvironmentSummary[];
  onCreated: (key: CreatedApiKey) => void;
  onError: (message: string) => void;
}) {
  const [applicationKey, setApplicationKey] = useState(applications[0]?.key ?? "");
  const [environmentKey, setEnvironmentKey] = useState(environments[0]?.key ?? "");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"server" | "client">("server");
  const [pending, startTransition] = useTransition();

  return (
    <section className="panel panel-ticks mt-6 p-5">
      <h2 className="eyebrow">Create a key</h2>

      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await createApiKey({ applicationKey, environmentKey, name, kind });
            if (result.ok) {
              onCreated(result.key);
              setName("");
            } else {
              onError(result.message);
            }
          });
        }}
      >
        <label className="flex flex-col gap-2">
          <span className="eyebrow">Application</span>
          <select
            className="field w-44"
            value={applicationKey}
            onChange={(event) => setApplicationKey(event.target.value)}
          >
            {applications.map((app) => (
              <option key={app.key} value={app.key}>
                {app.key}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-2">
          <span className="eyebrow">Environment</span>
          <select
            className="field w-40"
            value={environmentKey}
            onChange={(event) => setEnvironmentKey(event.target.value)}
          >
            {environments.map((env) => (
              <option key={env.key} value={env.key}>
                {env.key}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-2">
          <span className="eyebrow">Name</span>
          <input
            className="field w-52"
            value={name}
            required
            placeholder="Checkout service"
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="eyebrow">Kind</span>
          <select
            className="field w-40"
            value={kind}
            onChange={(event) => setKind(event.target.value as "server" | "client")}
          >
            <option value="server">server</option>
            <option value="client">client</option>
          </select>
        </label>

        <button className="btn btn-primary mb-0.5" type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create key"}
        </button>
      </form>

      {kind === "client" && (
        <p className="mt-3 text-[13px]" style={{ color: "var(--signal)" }}>
          A client key is public — it ships to browsers. It only ever receives flags marked
          client-safe.
        </p>
      )}
    </section>
  );
}

/** The one moment the raw key exists in the UI (spec §8). */
function RevealOnce({ created, onDismiss }: { created: CreatedApiKey; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);

  return (
    <section
      className="panel mt-6 p-5"
      style={{ boxShadow: "inset 0 0 0 1px var(--signal)" }}
    >
      <h2 className="text-sm font-semibold" style={{ color: "var(--signal)" }}>
        Copy this key now
      </h2>
      <p className="mt-2 text-[13px]" style={{ color: "var(--ink-dim)" }}>
        This is the only time it is shown. Cerebro stores a hash, so it cannot be recovered — if you
        lose it, revoke it and create another.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <code
          className="hud flex-1 px-3 py-2.5 text-[13px]"
          style={{ background: "var(--void)", color: "var(--signal)", minWidth: "20ch" }}
        >
          {created.key}
        </code>
        <button
          className="btn"
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(created.key).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button className="btn" type="button" onClick={onDismiss}>
          Done
        </button>
      </div>
    </section>
  );
}
