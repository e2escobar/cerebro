"use client";

import type { FlagEnvironmentView } from "@cerebro/contracts";
import { useState, useTransition } from "react";
import {
  demoteFlag,
  promoteFlag,
  setFlagEnabled,
  setFlagValue,
  type ActionResult,
} from "@/app/(app)/flags-actions";
import { ConfirmAction } from "@/components/confirm-action";
import { envColor } from "@/lib/env-color";

/**
 * One environment's state for a flag, with the controls to change it.
 *
 * Every control's availability comes from the `can*` booleans the API computed
 * for this user (spec §7.2) — the dashboard never re-derives permissions.
 */
export function EnvironmentCard({
  appKey,
  flagKey,
  type,
  env,
  rank,
  total,
  previousEnvKey,
  previousPromoted,
  isAdmin,
  isArchived,
}: {
  appKey: string;
  flagKey: string;
  type: string;
  env: FlagEnvironmentView;
  rank: number;
  total: number;
  previousEnvKey: string | null;
  previousPromoted: boolean;
  isAdmin: boolean;
  isArchived: boolean;
}) {
  const color = envColor(rank, total);
  const serverText = toEditorText(env.value, type);

  const [draft, setDraft] = useState(serverText);
  const [lastServerText, setLastServerText] = useState(serverText);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  // Promotion copies a value in from below, and other people change things.
  // When the server's value moves, the editor follows it.
  if (serverText !== lastServerText) {
    setLastServerText(serverText);
    setDraft(serverText);
  }

  const dirty = draft !== serverText;
  // Writes to a protected environment must be typed to confirm (spec §10).
  const confirmWith = env.isProtected ? flagKey : null;

  function report(result: ActionResult) {
    setMessage(result.ok ? null : result.message);
  }

  function save() {
    startSaving(async () => {
      report(await setFlagValue(appKey, flagKey, env.key, draft, type));
    });
  }

  const promoteBlockedBySequence = !previousPromoted && previousEnvKey !== null;
  const promoteReason = promoteBlockedBySequence
    ? `This flag must reach ${previousEnvKey} before ${env.key}.`
    : `You need promote on ${env.key}.`;

  return (
    <section
      className="panel p-5"
      style={env.enabled ? { boxShadow: `inset 3px 0 0 0 ${color}` } : undefined}
    >
      <header className="flex flex-wrap items-center gap-3">
        <span
          className={`station ${env.enabled ? "on" : ""} ${env.state === "promoted" ? "" : "absent"}`}
          style={{ "--c": color } as React.CSSProperties}
          aria-hidden
        />
        <h3 className="hud text-[15px] font-medium" style={{ color }}>
          {env.key}
        </h3>
        <span className="text-sm" style={{ color: "var(--ink-dim)" }}>
          {env.name}
        </span>
        {env.isProtected && <span className="badge badge-protected">protected</span>}
        <span className="badge ml-auto">
          {env.state === "promoted" ? (env.enabled ? "on" : "promoted, off") : "not promoted"}
        </span>
      </header>

      {env.state !== "promoted" ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <ConfirmAction
            label={`Promote to ${env.key}`}
            pendingLabel="Promoting…"
            className="btn"
            confirmWith={confirmWith}
            title={`Promote ${flagKey} to ${env.key}`}
            description={`It arrives switched off — promoting makes it available in ${env.key}, nothing more.`}
            disabled={isArchived || !env.canPromote || promoteBlockedBySequence}
            disabledReason={isArchived ? "This flag is archived." : promoteReason}
            onConfirm={() => promoteFlag(appKey, flagKey, env.key)}
            onResult={report}
          />
          <p className="text-[13px]" style={{ color: "var(--ink-dim)" }}>
            {isArchived
              ? "Archived flags cannot be promoted."
              : promoteBlockedBySequence
                ? `Waiting on ${previousEnvKey}.`
                : env.canPromote
                  ? "It will arrive switched off."
                  : promoteReason}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4">
            <label className="eyebrow" htmlFor={`value-${env.key}`}>
              Value
            </label>
            <div className="mt-2 flex flex-wrap items-start gap-2">
              <ValueEditor
                id={`value-${env.key}`}
                type={type}
                value={draft}
                onChange={setDraft}
                disabled={!env.canWrite || isArchived}
                title={env.canWrite ? undefined : `You need write on ${env.key}.`}
              />
              {env.isProtected ? (
                <ConfirmAction
                  label="Save value"
                  pendingLabel="Saving…"
                  confirmWith={confirmWith}
                  title={`Change ${flagKey} in ${env.key}`}
                  description="This environment is protected. Confirm the flag key to change its value."
                  disabled={!env.canWrite || !dirty || isArchived}
                  disabledReason={`You need write on ${env.key}.`}
                  onConfirm={() => setFlagValue(appKey, flagKey, env.key, draft, type)}
                  onResult={report}
                />
              ) : (
                <button
                  type="button"
                  className="btn"
                  onClick={save}
                  disabled={!env.canWrite || !dirty || saving || isArchived}
                  title={env.canWrite ? undefined : `You need write on ${env.key}.`}
                >
                  {saving ? "Saving…" : "Save value"}
                </button>
              )}
            </div>
            <p className="mt-2 text-xs" style={{ color: "var(--ink-dim)" }}>
              {env.enabled
                ? "This is what the SDK returns here."
                : "The SDK returns the default while this flag is off."}
            </p>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <ConfirmAction
              label={env.enabled ? `Turn off in ${env.key}` : `Turn on in ${env.key}`}
              pendingLabel={env.enabled ? "Turning off…" : "Turning on…"}
              className={env.enabled ? "btn" : "btn btn-primary"}
              confirmWith={confirmWith}
              title={`${env.enabled ? "Turn off" : "Turn on"} ${flagKey} in ${env.key}`}
              description={
                env.enabled
                  ? "Consumers fall back to the default value within 30 seconds."
                  : "Consumers pick up this environment's value within 30 seconds."
              }
              disabled={!env.canToggle || isArchived}
              disabledReason={`You need toggle on ${env.key}.`}
              onConfirm={() => setFlagEnabled(appKey, flagKey, env.key, !env.enabled)}
              onResult={report}
            />

            {isAdmin && rank > 0 && (
              <ConfirmAction
                label="Demote"
                pendingLabel="Demoting…"
                className="btn btn-danger"
                confirmWith={flagKey}
                title={`Demote ${flagKey} from ${env.key}`}
                description={`The flag disappears from ${env.key}'s payload entirely and arrives off if promoted again.`}
                onConfirm={() => demoteFlag(appKey, flagKey, env.key)}
                onResult={report}
              />
            )}

            {env.updatedBy && (
              <span className="text-xs" style={{ color: "var(--ink-dim)" }}>
                last changed by {env.updatedBy.name}
              </span>
            )}
          </div>
        </>
      )}

      {message && (
        <p role="alert" className="mt-4 text-[13px]" style={{ color: "var(--signal)" }}>
          {message}
        </p>
      )}
    </section>
  );
}

function toEditorText(value: unknown, type: string): string {
  if (type === "json") return JSON.stringify(value, null, 2);
  if (type === "boolean") return String(Boolean(value));
  return String(value ?? "");
}

function ValueEditor({
  id,
  type,
  value,
  onChange,
  disabled,
  title,
}: {
  id: string;
  type: string;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  title?: string;
}) {
  if (type === "boolean") {
    return (
      <select
        id={id}
        className="field hud w-auto"
        value={value}
        disabled={disabled}
        title={title}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  if (type === "json") {
    let invalid = false;
    try {
      JSON.parse(value);
    } catch {
      invalid = true;
    }

    return (
      <div className="min-w-0 flex-1">
        <textarea
          id={id}
          className="field hud min-h-28 resize-y"
          value={value}
          disabled={disabled}
          title={title}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          style={invalid ? { boxShadow: "inset 0 0 0 1px var(--signal)" } : undefined}
        />
        {invalid && (
          <p className="mt-1 text-xs" style={{ color: "var(--signal)" }}>
            This is not valid JSON.
          </p>
        )}
      </div>
    );
  }

  return (
    <input
      id={id}
      className="field hud max-w-xs flex-1"
      type={type === "number" ? "number" : "text"}
      step="any"
      value={value}
      disabled={disabled}
      title={title}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
