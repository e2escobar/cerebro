"use client";

import type { EnvironmentSummary } from "@cerebro/contracts";
import { useState, useTransition } from "react";
import {
  createEnvironment,
  deleteEnvironment,
  reorderEnvironments,
  updateEnvironment,
} from "@/app/(app)/admin-actions";
import type { ActionResult } from "@/app/(app)/flags-actions";
import { ConfirmAction } from "@/components/confirm-action";
import { envColor } from "@/lib/env-color";

/**
 * Reordering uses explicit move controls rather than drag: the order is the
 * promotion pipeline, so it must be reachable by keyboard, and the change is
 * staged until saved because the server validates it against every flag.
 */
export function EnvironmentManager({ environments }: { environments: EnvironmentSummary[] }) {
  const [order, setOrder] = useState(() => environments.map((e) => e.key));
  const [message, setMessage] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ flag: string; environments: string[] }[]>([]);
  const [saving, startSaving] = useTransition();

  const byKey = new Map(environments.map((e) => [e.key, e]));
  const savedOrder = environments.map((e) => e.key);
  const dirty = order.join() !== savedOrder.join();

  function move(index: number, delta: number) {
    const next = [...order];
    const target = index + delta;
    const a = next[index];
    const b = next[target];
    if (a === undefined || b === undefined) return;
    next[index] = b;
    next[target] = a;
    setOrder(next);
    setMessage(null);
    setBlocked([]);
  }

  function saveOrder() {
    startSaving(async () => {
      const result = await reorderEnvironments(order);
      if (result.ok) {
        setMessage(null);
        setBlocked([]);
        return;
      }

      setMessage(result.message);
      // The server names every flag the new order would strand (spec §7.2).
      const violations = result.details?.violations;
      setBlocked(
        Array.isArray(violations)
          ? (violations as { flag: string; environments: string[] }[])
          : [],
      );
    });
  }

  function report(result: ActionResult) {
    setMessage(result.ok ? null : result.message);
  }

  return (
    <>
      <section className="panel panel-ticks mt-6">
        <ol className="stripe">
          {order.map((key, index) => {
            const env = byKey.get(key);
            if (!env) return null;
            const color = envColor(index, order.length);

            return (
              <li
                key={key}
                className="flex flex-wrap items-center gap-3 px-5 py-4"
              >
                <span className="eyebrow w-10">#{index}</span>
                <span
                  className="station"
                  style={{ "--c": color } as React.CSSProperties}
                  aria-hidden
                />
                <span className="hud text-[15px] font-medium" style={{ color }}>
                  {env.key}
                </span>
                <span className="text-sm" style={{ color: "var(--ink-dim)" }}>
                  {env.name}
                </span>
                {env.isProtected && <span className="badge badge-protected">protected</span>}

                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${env.key} earlier`}
                  >
                    ↑
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === order.length - 1}
                    aria-label={`Move ${env.key} later`}
                  >
                    ↓
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() =>
                      startSaving(async () =>
                        report(await updateEnvironment(env.key, { isProtected: !env.isProtected })),
                      )
                    }
                  >
                    {env.isProtected ? "Unprotect" : "Protect"}
                  </button>
                  <ConfirmAction
                    label="Delete"
                    className="btn btn-danger"
                    confirmWith={env.key}
                    title={`Delete ${env.key}`}
                    description="Only possible when no flag is promoted here. Its API keys are deleted too."
                    onConfirm={() => deleteEnvironment(env.key)}
                    onResult={report}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {dirty && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" type="button" onClick={saveOrder} disabled={saving}>
            {saving ? "Saving order…" : `Save order: ${order.join(" → ")}`}
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              setOrder(savedOrder);
              setMessage(null);
              setBlocked([]);
            }}
          >
            Reset
          </button>
        </div>
      )}

      {message && (
        <p role="alert" className="mt-4 text-sm" style={{ color: "var(--signal)" }}>
          {message}
          {blocked.length > 0 && (
            <span className="mt-2 block">
              {blocked.map((violation) => (
                <span key={violation.flag} className="block">
                  <code className="hud">{violation.flag}</code> is promoted in{" "}
                  {violation.environments.join(", ")}
                </span>
              ))}
            </span>
          )}
        </p>
      )}

      <NewEnvironment nextRank={environments.length} onResult={report} />
    </>
  );
}

function NewEnvironment({
  nextRank,
  onResult,
}: {
  nextRank: number;
  onResult: (result: ActionResult) => void;
}) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [isProtected, setIsProtected] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <section className="panel panel-ticks mt-8 p-5">
      <h2 className="eyebrow">Add an environment</h2>
      <p className="mt-2 text-[13px]" style={{ color: "var(--ink-dim)" }}>
        It joins the end of the pipeline with every existing flag unpromoted. Move it into place
        afterwards.
      </p>

      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await createEnvironment({ key, name, rank: nextRank, isProtected });
            onResult(result);
            if (result.ok) {
              setKey("");
              setName("");
              setIsProtected(false);
            }
          });
        }}
      >
        <label className="flex flex-col gap-2">
          <span className="eyebrow">Key</span>
          <input
            className="field hud w-40"
            value={key}
            required
            spellCheck={false}
            placeholder="staging"
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
            placeholder="Staging"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 pb-2.5 text-sm">
          <input
            type="checkbox"
            checked={isProtected}
            onChange={(event) => setIsProtected(event.target.checked)}
          />
          Protected
        </label>
        <button className="btn btn-primary mb-0.5" type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add environment"}
        </button>
      </form>
    </section>
  );
}
