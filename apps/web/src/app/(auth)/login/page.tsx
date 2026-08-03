"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";

const initial: LoginState = { message: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, initial);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="flex items-baseline gap-3">
        <h1 className="wordmark text-2xl" style={{ color: "var(--signal)" }}>
          Cerebro
        </h1>
        <span className="eyebrow">v1</span>
      </div>
      <p className="prose mt-2 text-sm" style={{ color: "var(--ink-dim)" }}>
        Feature flags, promoted through an ordered pipeline.
      </p>

      <form action={formAction} className="panel panel-ticks mt-7 flex flex-col gap-5 p-7">
        <label className="flex flex-col gap-2">
          <span className="eyebrow">Email</span>
          <input
            className="field"
            type="text"
            name="email"
            autoComplete="username"
            autoFocus
            required
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="eyebrow">Password</span>
          <input
            className="field"
            type="password"
            name="password"
            autoComplete="current-password"
            required
          />
        </label>

        {state.message && (
          <p role="alert" className="prose text-sm" style={{ color: "var(--signal)" }}>
            {state.message}
          </p>
        )}

        <button className="btn btn-primary mt-1" type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
