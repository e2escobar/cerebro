"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

/**
 * Filters for the flag matrix.
 *
 * The URL stays the source of truth, so a filtered view is shareable and the
 * back button works. Typing is debounced and replaces the history entry rather
 * than pushing one — otherwise every keystroke would be somewhere to go back to.
 *
 * Without JavaScript this is still a plain GET form: it submits on Enter and
 * the server reads the same query parameters.
 */

const DEBOUNCE_MS = 280;

export function FlagFilters({
  q,
  type,
  archived,
}: {
  q: string;
  type: string;
  archived: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const [draft, setDraft] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow the URL when it changes underneath us — back button, or a link.
  const [lastQ, setLastQ] = useState(q);
  if (q !== lastQ) {
    setLastQ(q);
    setDraft(q);
  }

  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);

  function navigate(next: { q?: string; type?: string; archived?: boolean }) {
    // Any navigation supersedes a queued search. Without this, changing the
    // type while a debounce is in flight would be undone when the timer fired
    // with the values it captured.
    clearTimeout(timer.current ?? undefined);

    const params = new URLSearchParams();
    const nextQ = next.q ?? draft;
    const nextType = next.type ?? type;
    const nextArchived = next.archived ?? archived;

    if (nextQ.trim()) params.set("q", nextQ.trim());
    if (nextType) params.set("type", nextType);
    if (nextArchived) params.set("archived", "true");
    // Any filter change invalidates the cursor — page 2 of the old query is
    // meaningless against the new one.

    const query = params.toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  function onType(value: string) {
    setDraft(value);
    clearTimeout(timer.current ?? undefined);
    timer.current = setTimeout(() => navigate({ q: value }), DEBOUNCE_MS);
  }


  /** Enter should not wait out the debounce. */
  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    navigate({ q: draft });
  }

  return (
    <form className="mt-6 flex flex-wrap items-center gap-2" onSubmit={onSubmit} role="search">
      <div className="relative max-w-xs flex-1">
        <input
          className="field pr-9"
          type="search"
          name="q"
          placeholder="Search flags"
          value={draft}
          onChange={(event) => onType(event.target.value)}
          aria-label="Search flags"
          aria-busy={pending}
          autoComplete="off"
        />
        <span
          className={`filter-pulse ${pending ? "is-active" : ""}`}
          aria-hidden
        />
        <span aria-live="polite" className="sr-only">
          {pending ? "Filtering flags" : ""}
        </span>
      </div>

      <select
        className="field w-auto"
        name="type"
        value={type}
        onChange={(event) => navigate({ type: event.target.value })}
        aria-label="Type"
      >
        <option value="">All types</option>
        <option value="boolean">boolean</option>
        <option value="string">string</option>
        <option value="number">number</option>
        <option value="json">json</option>
      </select>

      <label className="eyebrow flex items-center gap-2 px-2">
        <input
          type="checkbox"
          name="archived"
          value="true"
          checked={archived}
          onChange={(event) => navigate({ archived: event.target.checked })}
        />
        Archived
      </label>

      {(q || type || archived) && (
        <button
          className="btn"
          type="button"
          onClick={() => {
            setDraft("");
            navigate({ q: "", type: "", archived: false });
          }}
        >
          Clear
        </button>
      )}

      {/* Enter still works, and this is the whole form without JavaScript. */}
      <noscript>
        <button className="btn" type="submit">
          Apply
        </button>
      </noscript>
    </form>
  );
}
