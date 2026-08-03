# Cerebro

A self-hosted feature flag service. Flags belong to an **application** and are
created in the lowest environment, then promoted upward through an ordered
pipeline (dev → qa → prod). Applications read their own flags through a
key-value HTTP endpoint; the dashboard and management API expose full metadata.

Two applications may each have a flag called `new-checkout` — they are unrelated
flags with their own type, default and per-environment state, and neither ever
sees the other's.

**[docs/overview.md](docs/overview.md)** explains what the service does, with
diagrams — start there. The specification is [`plan/foundation.md`](plan/foundation.md). All eight phases
are implemented: scaffold, schema, core domain, management API, evaluation API,
dashboard, admin surfaces, and the typed client library. The dashboard's visual
direction is in [`design/direction.md`](design/direction.md).

## Stack

Bun workspaces · Hono on `Bun.serve` · PostgreSQL 16 · Drizzle ORM · Zod ·
`bun test` · Next.js 15 App Router + Tailwind v4.

## Getting started

```bash
cp .env.example .env          # then set SESSION_SECRET and SEED_ADMIN_PASSWORD
docker compose up -d          # Postgres 16 on :5434
bun install
bun run db:migrate
bun run db:seed
bun run dev                   # API on :3011, dashboard on :3000
```

The seed creates `admin@local` (admin) and `dev@local` (developer with full
rights on dev and qa, read-only on prod), the three environments, and a
`default` application to put flags in.

## Layout

| Path | What lives there |
|---|---|
| `apps/api` | Hono server — evaluation and management route trees |
| `apps/web` | Next.js dashboard |
| `packages/db` | Drizzle schema, migrations, seed — the authoritative data model |
| `packages/core` | Domain layer: rbac, applications, flags, promotion, payload, audit |
| `packages/contracts` | Zod schemas and types shared by api and web |
| `packages/client` | `@cerebro/client` — the published library and `cerebro-codegen`, with React and Next entry points. See its [README](packages/client/README.md) |
| `design/` | Visual direction and the flag matrix reference render |
| `scripts/` | Acceptance walkthroughs |

The Next.js app never imports `packages/core` or `packages/db` — it talks to the
API over HTTP, so there is exactly one authorization path.

`packages/client` is the only package meant to leave this repo, so it is also
the only one that is built rather than consumed as source: `bun run build` emits
ESM, CommonJS and declarations for its three entry points. Everything else stays
`private` and exports `src/index.ts` directly.

## Commands

```bash
bun run dev          # Postgres + API + dashboard
bun test             # 183 tests across core, api and client, against a real Postgres
bun run typecheck    # every workspace
bun run lint
bun run db:generate  # after editing packages/db/src/schema.ts
bun run db:reset     # drop and recreate the schema (development only)
```

`bun test` uses a dedicated `cerebro_test` database, created and migrated
automatically on first run.

## Acceptance scripts

With the API running and the database seeded:

```bash
bash scripts/walkthrough.sh        # management API, developer → admin, 19 checks
bash scripts/evaluation-check.sh   # SDK keys, payloads, ETag caching, isolation, 18 checks
bash scripts/codegen-check.sh      # cerebro-codegen output narrows get() per key
```

`walkthrough.sh` creates `new-checkout`; run it before the other two.

## API

Interactive reference at **`/docs`**, OpenAPI 3.1 document at
**`/v1/openapi.json`** — both public, since you read them before you have
credentials. Point any OpenAPI tool at the document to generate a client:

```bash
curl localhost:3011/v1/openapi.json -o cerebro.json
```

Request bodies and query strings in the document are converted from the Zod
schemas in `packages/contracts` — the same objects the handlers validate
against — so the documented constraints are the enforced ones. Response shapes
are described by hand in `apps/api/src/docs/openapi.ts`.
`apps/api/test/openapi.test.ts` fails if a route is undocumented or a documented
path has no route, so the two cannot drift apart.

Two route trees on one server, sharing no middleware, so they can be split into
separate deployments later without touching handlers.

**Evaluation** — `Authorization: Bearer <sdk key>`. The application *and*
environment come from the key, never from a path or query parameter — so the
same build runs everywhere and one application never sees another's flags.

| Method | Path | |
|---|---|---|
| GET | `/v1/flags` | Flat key-value map. `ETag`, `Cache-Control: max-age=30`, 304 on `If-None-Match` |
| GET | `/v1/config-version` | Cheap poll target |

**Management** — session cookie `cerebro_session`. Base `/v1/mgmt`, plus
`/v1/auth/{login,logout,me}`. Applications, flags, environments, api-keys,
users, permissions and audit. Flags nest under their application:
`/v1/mgmt/applications/{appKey}/flags/{key}`. Application, flag and environment
keys are the public identifiers — UUIDs never appear in URLs.

## Dashboard

| Page | |
|---|---|
| `/` | Applications, or straight into the only one |
| `/apps/[appKey]` | Flag matrix — one row per flag, one column per environment |
| `/apps/[appKey]/flags/[key]` | Per-environment cards with typed value editors, toggle, promote |
| `/applications` | Create, rename and delete applications (admin) |
| `/environments` | Reorder the pipeline, protect, delete (admin) |
| `/keys` | Create and revoke SDK keys, scoped to an application + environment (admin) |
| `/team` | People, roles, and the per-environment permission grid (admin) |
| `/audit` | Filterable log with before/after expansion |

Every control's availability comes from the `can*` booleans the API computes for
the signed-in user — the dashboard never re-derives permissions. Writes to a
protected environment require typing the flag key to confirm.

## Deviations from the spec

Six, each deliberate:

1. **`env_permission` enum renamed to `env_permission_kind`.** Postgres puts
   types and tables in one namespace, so the spec's enum and table of the same
   name cannot coexist. The table keeps the spec's name.
2. **`audit_log.environment_id` is `ON DELETE SET NULL`; `promotion.to_env_id` is
   `ON DELETE CASCADE`.** Without this, `DELETE /environments/:key` — a documented
   route — fails permanently once any history exists.
3. **`is_client_safe` bumps every environment's `config_version`,** not one. It
   changes what client keys see everywhere.
4. **Toggling requires the flag to be promoted in that environment.** An
   unpromoted flag is absent from that environment's payload, so enabling it
   there has no meaning.
5. **Applications exist at all.** The spec scopes out "multi-project support"
   and says a flag key is globally unique. Without applications, every service
   sharing an install sees every other service's flags — a browser client key
   leaks their names — and two teams cannot both own `new-checkout`. An
   application owns its flags, and an SDK key resolves to *(application,
   environment)* exactly as it resolved to an environment before, so the
   evaluation contract and the SDK are unchanged.
6. **Environments reorder with move controls, not drag.** The order is the
   promotion pipeline, so it has to be reachable by keyboard; the change is
   staged until saved because the server validates it against every flag.

The `flag_environment.value` type backstop is a constraint trigger rather than a
`CHECK`, because a table-level check cannot reach `flag.type`.

`config_version` moved from `environment` onto `(application, environment)`, so
one team's release no longer invalidates every other application's cached
payload. The ETag reads `W/"<app>-<env>-<version>"`.

## Licence

MIT — see [LICENSE](LICENSE).

The display face is [Chakra Petch](https://fonts.google.com/specimen/Chakra+Petch)
(SIL Open Font License), with IBM Plex Sans and IBM Plex Mono (also OFL). All are
fetched at build time by `next/font` and self-hosted thereafter; nothing is
loaded from a CDN at runtime.

