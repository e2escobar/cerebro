"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createFlag, type CreateFlagState } from "@/app/(app)/flags-actions";
import { useParams } from "next/navigation";

const initial: CreateFlagState = { message: null };

const DEFAULTS: Record<string, string> = {
  boolean: "false",
  string: "",
  number: "0",
  json: "{}",
};

export default function NewFlagPage() {
  const appKey = String(useParams().appKey);
  const [state, formAction, pending] = useActionState(
    createFlag.bind(null, appKey),
    initial,
  );
  const [type, setType] = useState("boolean");
  const [defaultValue, setDefaultValue] = useState(DEFAULTS.boolean ?? "false");

  function changeType(next: string) {
    setType(next);
    setDefaultValue(DEFAULTS[next] ?? "");
  }

  return (
    <>
      <Link href={`/apps/${appKey}`} className="eyebrow" style={{ color: "var(--ink-dim)" }}>
        ← {appKey}
      </Link>

      <h1 className="title">New flag</h1>
      <p className="prose mt-2 max-w-prose text-sm" style={{ color: "var(--ink-dim)" }}>
        It is created in the first environment, switched off. Promote it upward from there.
      </p>

      <form action={formAction} className="panel panel-ticks mt-6 flex max-w-xl flex-col gap-5 p-6">
        <label className="flex flex-col gap-2">
          <span className="eyebrow">Key</span>
          <input
            className="field hud"
            name="key"
            required
            autoFocus
            spellCheck={false}
            placeholder="new-checkout"
            pattern="[a-z][a-z0-9-]{1,63}"
            title="Lowercase letters, digits and dashes, 2–64 characters"
          />
          <span className="text-xs" style={{ color: "var(--ink-dim)" }}>
            Permanent. This is what your code will ask for.
          </span>
        </label>

        <label className="flex flex-col gap-2">
          <span className="eyebrow">Name</span>
          <input className="field" name="name" required placeholder="New checkout flow" />
        </label>

        <label className="flex flex-col gap-2">
          <span className="eyebrow">Description</span>
          <textarea className="field min-h-20 resize-y" name="description" />
        </label>

        <label className="flex flex-col gap-2">
          <span className="eyebrow">Type</span>
          <select
            className="field"
            name="type"
            value={type}
            onChange={(event) => changeType(event.target.value)}
          >
            <option value="boolean">boolean</option>
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="json">json</option>
          </select>
          <span className="text-xs" style={{ color: "var(--ink-dim)" }}>
            Permanent. A flag cannot change type later.
          </span>
        </label>

        <label className="flex flex-col gap-2">
          <span className="eyebrow">Default value</span>
          {type === "boolean" ? (
            <select
              className="field"
              name="defaultValue"
              value={defaultValue}
              onChange={(event) => setDefaultValue(event.target.value)}
            >
              <option value="false">false</option>
              <option value="true">true</option>
            </select>
          ) : type === "json" ? (
            <textarea
              className="field hud min-h-24 resize-y"
              name="defaultValue"
              value={defaultValue}
              spellCheck={false}
              onChange={(event) => setDefaultValue(event.target.value)}
            />
          ) : (
            <input
              className="field hud"
              name="defaultValue"
              type={type === "number" ? "number" : "text"}
              step="any"
              value={defaultValue}
              onChange={(event) => setDefaultValue(event.target.value)}
            />
          )}
          <span className="text-xs" style={{ color: "var(--ink-dim)" }}>
            What the SDK returns wherever this flag is off.
          </span>
        </label>

        <label className="flex items-start gap-3">
          <input type="checkbox" name="isClientSafe" className="mt-1" />
          <span className="text-[13px]">
            Safe to send to browsers
            <span className="block" style={{ color: "var(--ink-dim)" }}>
              Client keys are public. Only mark flags whose value can be seen by anyone.
            </span>
          </span>
        </label>

        {state.message && (
          <p role="alert" className="text-sm" style={{ color: "var(--signal)" }}>
            {state.message}
          </p>
        )}

        <div className="flex gap-2">
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create flag"}
          </button>
          <Link className="btn" href={`/apps/${appKey}`}>
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
