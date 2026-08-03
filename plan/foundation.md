# Feature flag service — implementation plan

Build a self-hosted, single-organization feature flag service. Typed flags are created in the lowest environment and promoted upward through an ordered pipeline (dev → qa → prod). Applications read flags through a lightweight key-value HTTP endpoint; the dashboard and management API expose the full metadata.

This document is the specification. Follow the phases in order. Do not skip ahead — each phase has acceptance criteria that must pass before moving on.

---

## 1. Scope

### In scope (v1)

- Single organization, single project. No tenancy, no org/project tables, no row-level scoping.
- Two user roles: `admin` and `developer`.
- Admin-managed environments with an explicit ordered promotion pipeline.
- Four flag value types: `boolean`, `string`, `number`, `json`.
- Sequential promotion with guard rules, independent of enable/disable.
- Evaluation API returning a flat key-value JSON map, authenticated by environment-scoped SDK key.
- Management API returning full flag metadata, authenticated by user session.
- Per-environment permission grants for developers.
- Audit log of every mutation.
- Next.js + Tailwind dashboard.

### Explicitly out of scope (v1)

Do not build these. Do not add schema columns or abstractions "in preparation" for them either — the schema below is deliberately shaped so they can be added later without breaking the payload contract.

- Percentage rollouts, user targeting, segments, or any rule evaluation against a request context.
- Scheduled or timed releases.
- Approval workflows on promotion.
- Multi-project or multi-org support.
- SSE / websocket streaming of flag changes (SDK polls with ETag instead).
- SSO / OAuth login.
- Flag dependency graphs or prerequisites.

---

## 2. Stack

| Concern | Choice | Notes |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | `pnpm@9`, Node 20+ |
| API | Hono | Node adapter (`@hono/node-server`) |
| Dashboard | Next.js 15, App Router | React Server Components |
| Styling | Tailwind CSS v4 | Shared preset in `packages/ui` |
| Database | PostgreSQL 16 | JSONB for flag values |
| ORM / migrations | Drizzle ORM + drizzle-kit | Schema in `packages/db` is the source of truth |
| Validation | Zod | Shared schemas in `packages/contracts` |
| Password hashing | `@node-rs/argon2` | |
| Testing | Vitest | Integration tests against a real Postgres via Docker |
| Lint / format | ESLint + Prettier | Shared config package |

### Cross-cutting decisions (do not deviate)

1. **The Next.js app never imports `packages/core` or `packages/db`.** It talks to the Hono API over HTTP, forwarding the session cookie. This guarantees exactly one authorization path. Server Components fetch; Server Actions proxy mutations.
2. **All authorization lives in `packages/core`** as a single `can(actor, action, environmentId)` function. No permission logic in route handlers beyond calling it.
3. **The evaluation API and the management API are separate Hono route trees** mounted on one server. They share no middleware. This allows splitting them into separate deployments later without touching handlers.
4. **Every mutation writes an audit row and bumps the affected environment's `config_version` in the same transaction.**

---

## 3. Repository layout

```
feature-flags/
├── apps/
│   ├── api/                    Hono server
│   │   ├── src/
│   │   │   ├── index.ts        Server bootstrap, mounts both trees
│   │   │   ├── evaluation/     Evaluation API route tree
│   │   │   │   ├── router.ts
│   │   │   │   └── middleware/sdk-key.ts
│   │   │   ├── management/     Management API route tree
│   │   │   │   ├── router.ts
│   │   │   │   ├── routes/     auth, flags, environments, keys, users, permissions, audit
│   │   │   │   └── middleware/ session.ts, require-admin.ts, error-handler.ts
│   │   │   └── lib/            request context, response helpers
│   │   └── test/
│   └── web/                    Next.js dashboard
│       ├── src/app/
│       │   ├── (auth)/login/
│       │   ├── (app)/
│       │   │   ├── page.tsx                    Flag matrix
│       │   │   ├── flags/[key]/page.tsx        Flag detail
│       │   │   ├── environments/page.tsx       Admin
│       │   │   ├── keys/page.tsx               Admin
│       │   │   ├── team/page.tsx               Admin
│       │   │   └── audit/page.tsx
│       │   └── layout.tsx
│       └── src/lib/api-client.ts               Typed fetch wrapper
├── packages/
│   ├── db/                     Drizzle schema, migrations, seed script
│   ├── core/                   Domain layer — see section 6
│   ├── contracts/              Zod schemas + inferred types shared by api and web
│   ├── sdk/                    Typed client + `ff-codegen` CLI
│   ├── ui/                     Tailwind preset, shared React components
│   └── tsconfig/               Base tsconfig files
├── docker-compose.yml          Postgres for local dev
├── turbo.json
└── pnpm-workspace.yaml
```

---

## 4. Data model

Drizzle schema in `packages/db/src/schema.ts` is authoritative. The SQL below documents intent.

### Enums

```sql
CREATE TYPE user_role       AS ENUM ('admin', 'developer');
CREATE TYPE flag_type       AS ENUM ('boolean', 'string', 'number', 'json');
CREATE TYPE flag_env_state  AS ENUM ('not_promoted', 'promoted');
CREATE TYPE env_permission  AS ENUM ('read', 'write', 'toggle', 'promote');
CREATE TYPE api_key_kind    AS ENUM ('server', 'client');
```

### Tables

```sql
CREATE TABLE app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  role          user_role NOT NULL DEFAULT 'developer',
  disabled_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE session (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON session (user_id);

CREATE TABLE environment (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key             text NOT NULL UNIQUE,          -- 'dev', 'qa', 'prod'; ^[a-z][a-z0-9-]{1,31}$
  name            text NOT NULL,
  rank            integer NOT NULL UNIQUE,       -- 0 = lowest = creation environment
  is_protected    boolean NOT NULL DEFAULT false,
  config_version  bigint NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE flag (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key            text NOT NULL UNIQUE,           -- ^[a-z][a-z0-9-]{1,63}$
  name           text NOT NULL,
  description    text NOT NULL DEFAULT '',
  type           flag_type NOT NULL,             -- IMMUTABLE after creation
  default_value  jsonb NOT NULL,                 -- fallback returned when disabled
  is_client_safe boolean NOT NULL DEFAULT false,
  created_by     uuid NOT NULL REFERENCES app_user(id),
  archived_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON flag (archived_at);

CREATE TABLE flag_environment (
  flag_id          uuid NOT NULL REFERENCES flag(id) ON DELETE CASCADE,
  environment_id   uuid NOT NULL REFERENCES environment(id) ON DELETE CASCADE,
  state            flag_env_state NOT NULL DEFAULT 'not_promoted',
  enabled          boolean NOT NULL DEFAULT false,
  value            jsonb NOT NULL,
  promoted_at      timestamptz,
  first_enabled_at timestamptz,
  updated_by       uuid REFERENCES app_user(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (flag_id, environment_id)
);
CREATE INDEX ON flag_environment (environment_id, state);

CREATE TABLE env_permission (
  user_id        uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  environment_id uuid NOT NULL REFERENCES environment(id) ON DELETE CASCADE,
  permission     env_permission NOT NULL,
  granted_by     uuid NOT NULL REFERENCES app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, environment_id, permission)
);

CREATE TABLE api_key (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id uuid NOT NULL REFERENCES environment(id) ON DELETE CASCADE,
  name           text NOT NULL,
  kind           api_key_kind NOT NULL,
  prefix         text NOT NULL,                  -- displayable, e.g. 'ffk_prod_7f3a'
  key_hash       text NOT NULL UNIQUE,           -- sha256 of full key
  last_used_at   timestamptz,
  revoked_at     timestamptz,
  created_by     uuid NOT NULL REFERENCES app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON api_key (environment_id);

CREATE TABLE promotion (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_id        uuid NOT NULL REFERENCES flag(id) ON DELETE CASCADE,
  from_env_id    uuid REFERENCES environment(id),  -- null for initial creation in rank 0
  to_env_id      uuid NOT NULL REFERENCES environment(id),
  value_snapshot jsonb NOT NULL,
  actor_id       uuid NOT NULL REFERENCES app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON promotion (flag_id, created_at DESC);

CREATE TABLE audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id       uuid REFERENCES app_user(id),
  action         text NOT NULL,        -- see action list below
  entity_type    text NOT NULL,        -- 'flag' | 'environment' | 'api_key' | 'user' | 'permission'
  entity_id      uuid,
  environment_id uuid REFERENCES environment(id),
  before         jsonb,
  after          jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (created_at DESC);
CREATE INDEX ON audit_log (entity_type, entity_id);
```

### Audit action vocabulary

`flag.created`, `flag.updated`, `flag.archived`, `flag.restored`, `flag.promoted`, `flag.demoted`, `flag.enabled`, `flag.disabled`, `flag.value_changed`, `environment.created`, `environment.updated`, `environment.reordered`, `environment.deleted`, `api_key.created`, `api_key.revoked`, `user.created`, `user.updated`, `user.disabled`, `permission.granted`, `permission.revoked`.

---

## 5. Domain rules

### 5.1 Flag types

- `type` is set at creation and is **immutable**. There is no endpoint to change it.
- Value validation is keyed off `type`, implemented in `packages/core/src/flag-value.ts`:
  - `boolean` → Zod `z.boolean()`
  - `string` → `z.string()`
  - `number` → `z.number().finite()`
  - `json` → `z.unknown()`, must serialize to ≤ 32 KB
- The same validator runs on: flag creation (`default_value` and initial value), value edits, and promotion.
- Add a Postgres `CHECK` constraint as a backstop asserting `jsonb_typeof` matches the type for boolean/string/number. Domain validation is what produces user-facing errors.

### 5.2 Flag creation

Creating a flag runs in one transaction:

1. Insert the `flag` row.
2. Insert a `flag_environment` row for **every** environment, with `value = default_value`, `enabled = false`.
3. Set `state = 'promoted'`, `promoted_at = now()` on the row for the lowest-rank environment only. All others stay `not_promoted`.
4. Insert a `promotion` row with `from_env_id = null`, `to_env_id = <rank 0 env>`.
5. Bump `config_version` on the rank-0 environment.
6. Write `flag.created` audit row.

When a **new environment** is created, insert a `not_promoted` `flag_environment` row for every existing non-archived flag.

### 5.3 Promotion

`POST /flags/:key/environments/:envKey/promote`

Guards, all must pass:

1. Target environment exists and its `rank > 0`.
2. Flag is not archived.
3. Flag's `state = 'promoted'` in **every** environment whose rank is lower than the target's.
4. Actor has `promote` on the target environment (or is admin).
5. Flag is currently `not_promoted` in the target (promoting twice is a no-op error, `409`).

Effect, in one transaction:

- Copy `value` from the highest-ranked environment below the target where the flag is promoted.
- Set `state = 'promoted'`, `promoted_at = now()`, `enabled = false`.
- Insert `promotion` row.
- Bump target env `config_version`.
- Audit `flag.promoted`.

**Promotion never enables a flag.** It makes the flag available to be enabled.

**Demotion** (`DELETE .../promote`) is admin-only, blocked if the flag is promoted in any higher-ranked environment, and resets the row to `not_promoted`, `enabled = false`.

### 5.4 Enable / disable and value edits

- `enabled` toggles freely in any direction with no ordering constraint. This is the kill switch.
- On first transition to `enabled = true`, set `first_enabled_at` if null.
- Editing `value` requires `write` on that environment; toggling requires `toggle`.
- Both bump `config_version` on that environment and write an audit row.

### 5.5 Value resolution

For a given flag in a given environment, the resolved value the SDK receives is:

```
state !== 'promoted'  →  flag is omitted from the payload entirely
enabled === true      →  flag_environment.value
enabled === false     →  flag.default_value
```

This guarantees every key present in the payload has a value of the declared type, so consumers never handle `undefined`.

### 5.6 Authorization

`can(actor, action, environmentId?)` in `packages/core/src/rbac.ts`.

- `actor.role === 'admin'` → returns true for everything. Admins bypass `env_permission`.
- Developers need an explicit `env_permission` row matching the required permission.

| Action | Required |
|---|---|
| `environment.create` / `update` / `reorder` / `delete` | admin |
| `api_key.create` / `revoke` | admin |
| `user.*`, `permission.*` | admin |
| `flag.create` | `write` on the rank-0 environment |
| `flag.update_metadata` (name, description, client-safe) | `write` on rank-0 environment |
| `flag.archive` / `restore` | admin, or `write` on rank-0 **and** flag not promoted above rank 0 |
| `flag.set_value` in env E | `write` on E |
| `flag.toggle` in env E | `toggle` on E |
| `flag.promote` into env E | `promote` on E |
| `flag.demote` from env E | admin |
| `flag.read` in env E | `read` on E |
| `audit.read` | any authenticated user |

`is_protected` on an environment is advisory in v1: the dashboard requires a typed confirmation (type the flag key) before toggling or promoting in a protected environment. It does not change API-level rules.

---

## 6. `packages/core` surface

Pure domain logic. Takes a transaction/db handle as an argument; performs no HTTP, reads no environment variables.

```
core/src/
├── rbac.ts            can(), loadActorPermissions()
├── flag-value.ts      validateValue(type, value), coerce helpers
├── flags.ts           createFlag, updateFlag, archiveFlag, setValue, toggle
├── promotion.ts       promoteFlag, demoteFlag, assertPromotable
├── environments.ts    createEnvironment, reorderEnvironments, bumpConfigVersion
├── api-keys.ts        generateKey, hashKey, resolveKey
├── payload.ts         buildEvaluationPayload(envId, { clientOnly })
├── audit.ts           writeAudit
└── errors.ts          DomainError subclasses with stable codes
```

Every mutating function accepts `{ db, actor }` and throws typed `DomainError`s. The API layer maps `DomainError.code` to HTTP status — handlers contain no business branching.

---

## 7. API contracts

Base: `/v1`. All responses JSON. Error shape:

```json
{ "error": { "code": "FLAG_NOT_PROMOTABLE", "message": "Flag must be promoted to qa first", "details": {} } }
```

Status mapping: `400` validation, `401` unauthenticated, `403` forbidden, `404` not found, `409` conflict/state violation, `422` domain rule violation, `500` unexpected.

### 7.1 Evaluation API

Authenticated by `Authorization: Bearer <sdk key>`. The environment is derived from the key — **never** from a path or query parameter.

#### `GET /v1/flags`

Response `200`:

```json
{
  "new-checkout": true,
  "max-cart-items": 50,
  "banner-copy": "Summer sale",
  "pricing-rules": { "tier": "b", "discount": 0.1 }
}
```

Headers: `ETag: W/"<env.key>-<config_version>"`, `Cache-Control: public, max-age=30`, `X-Config-Version: <n>`.

If `If-None-Match` matches, return `304` with no body.

Filtering: `state = 'promoted'` and `flag.archived_at IS NULL`. If the key's `kind = 'client'`, additionally `is_client_safe = true`.

Side effect: update `api_key.last_used_at` at most once per minute per key (throttle in memory; do not write on every request).

#### `GET /v1/config-version`

Cheap poll target. Returns `{ "version": 42, "environment": "prod" }`.

### 7.2 Management API

Authenticated by session cookie `ff_session` (httpOnly, secure, sameSite=lax).

#### Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/auth/login` | `{ email, password }` → sets cookie, returns user |
| POST | `/v1/auth/logout` | Deletes session |
| GET | `/v1/auth/me` | Current user + effective permissions per environment |

#### Flags

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/mgmt/flags` | Full list. Query: `q`, `type`, `environment`, `state`, `archived`, `cursor`, `limit`. Each item includes the full per-environment matrix. |
| POST | `/v1/mgmt/flags` | `{ key, name, description, type, defaultValue, isClientSafe, initialValue? }` |
| GET | `/v1/mgmt/flags/:key` | Full record + environment states + promotion history + recent audit |
| PATCH | `/v1/mgmt/flags/:key` | `name`, `description`, `isClientSafe` only. Never `type` or `key`. |
| POST | `/v1/mgmt/flags/:key/archive` | |
| POST | `/v1/mgmt/flags/:key/restore` | |
| PUT | `/v1/mgmt/flags/:key/environments/:envKey/value` | `{ value }` |
| PUT | `/v1/mgmt/flags/:key/environments/:envKey/enabled` | `{ enabled }` |
| POST | `/v1/mgmt/flags/:key/environments/:envKey/promote` | |
| DELETE | `/v1/mgmt/flags/:key/environments/:envKey/promote` | Demote, admin only |

`GET /v1/mgmt/flags/:key` response shape:

```json
{
  "key": "new-checkout",
  "name": "New checkout flow",
  "description": "Rewritten cart and payment step",
  "type": "boolean",
  "defaultValue": false,
  "isClientSafe": true,
  "archivedAt": null,
  "createdBy": { "id": "...", "name": "Ana" },
  "createdAt": "2026-07-01T10:00:00Z",
  "environments": [
    {
      "key": "dev", "name": "Development", "rank": 0,
      "state": "promoted", "enabled": true, "value": true,
      "promotedAt": "...", "firstEnabledAt": "...",
      "updatedBy": { "id": "...", "name": "Ana" }, "updatedAt": "...",
      "canPromote": false, "canToggle": true, "canWrite": true
    },
    {
      "key": "qa", "rank": 1, "state": "not_promoted", "enabled": false,
      "value": false, "canPromote": true, "canToggle": false, "canWrite": false
    }
  ],
  "promotions": [ { "fromEnv": null, "toEnv": "dev", "actor": "Ana", "createdAt": "..." } ]
}
```

The `canPromote` / `canToggle` / `canWrite` booleans are computed server-side from `can()` for the requesting user. The dashboard renders from these — it must not re-derive permissions client-side.

#### Environments, keys, users, permissions (admin only)

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/mgmt/environments` | Readable by all authenticated users |
| POST | `/v1/mgmt/environments` | `{ key, name, rank, isProtected }`; backfills `flag_environment` rows |
| PATCH | `/v1/mgmt/environments/:key` | `name`, `isProtected` |
| PUT | `/v1/mgmt/environments/order` | `{ order: ["dev","qa","staging","prod"] }`, reassigns ranks in one transaction |
| DELETE | `/v1/mgmt/environments/:key` | Blocked if any flag is promoted there |
| GET | `/v1/mgmt/api-keys` | Never returns the raw key |
| POST | `/v1/mgmt/api-keys` | `{ environmentKey, name, kind }` → returns raw key **once** |
| DELETE | `/v1/mgmt/api-keys/:id` | Revoke |
| GET/POST/PATCH | `/v1/mgmt/users` | Create with temp password; `role`, `disabledAt` |
| GET | `/v1/mgmt/users/:id/permissions` | |
| PUT | `/v1/mgmt/users/:id/permissions` | `{ grants: [{ environmentKey, permissions: ["read","write"] }] }` — full replace |
| GET | `/v1/mgmt/audit` | Filters: `entityType`, `entityId`, `environmentKey`, `actorId`, `from`, `to`, cursor |

Environment reordering must reject any order that would place an environment where a flag is promoted above one where it is not. Validate the full flag set before committing.

---

## 8. SDK keys

- Format: `ffk_<envKey>_<32 url-safe random chars>`. Example: `ffk_prod_9tKq2mR7wZxL4nB8vC1sD6fG0hJ3pQaE`.
- Store `sha256(fullKey)` in `key_hash` (unique index) and the first 12 characters in `prefix` for display.
- Lookup: hash the incoming bearer token, single indexed query. Reject if `revoked_at IS NOT NULL` or the environment was deleted.
- Raw key is returned exactly once at creation and never retrievable again. The dashboard must make this obvious.
- `client` keys are assumed public. Warn in the UI when creating one.

---

## 9. Caching and versioning

- `environment.config_version` is a bigint bumped by `bumpConfigVersion(envId)` inside the same transaction as any write affecting that environment's payload.
- Writes that bump it: flag creation (rank-0 env), promotion, demotion, value change, enable/disable, archive/restore, flag metadata change affecting `is_client_safe`.
- The evaluation API builds a weak ETag from `env.key + config_version`.
- Add a per-process in-memory cache keyed by `${envId}:${kind}:${config_version}`, invalidated implicitly because the key changes. Cap at 100 entries. No Redis in v1.
- The SDK polls `GET /v1/flags` with `If-None-Match` every 30 seconds by default.

---

## 10. Dashboard

Tailwind, no component library dependency beyond what you add to `packages/ui`. Environment identity color is a design token (`--env-dev`, `--env-qa`, `--env-prod`) used consistently in pills, headers, and the matrix.

### Pages

**`/` — flag matrix.** One row per flag, one column per environment ordered by rank. Each cell is a pill with three visual states: not promoted (outline, muted), promoted + off (solid neutral), promoted + on (solid environment color). Row shows key, name, and type badge. Filters: search, type, environment state, archived toggle.

**`/flags/[key]` — flag detail.** Header with key, type badge, description, client-safe indicator. Below, one card per environment in rank order containing: state, a value editor appropriate to the type (checkbox for boolean, text input for string, number input for number, JSON textarea with validation for json), an enable/disable toggle, and a promote button. Disabled controls render with a tooltip explaining which permission is missing, driven by the `can*` booleans from the API. Right column: promotion history and audit timeline.

**`/environments`** (admin) — list with drag-to-reorder, create form, protected toggle, delete with blocking-flag warning.

**`/keys`** (admin) — grouped by environment, shows prefix, kind, last used, revoke action. Creation modal displays the raw key once with a copy button and a permanent warning.

**`/team`** (admin) — user list, role selector, and a permission grid: users as rows, environments as columns, four checkboxes per cell.

**`/audit`** — filterable table with before/after diff expansion.

### Confirmation rules

Any toggle, value edit, or promotion targeting an environment with `is_protected = true` requires the user to type the flag key into a confirmation dialog.

---

## 11. Implementation phases

Complete each phase fully, including its acceptance criteria, before starting the next.

### Phase 0 — Scaffold

- pnpm workspace, Turborepo pipeline, shared tsconfig and ESLint packages.
- `docker-compose.yml` with Postgres 16.
- `packages/db` with Drizzle configured, empty schema, migration script.
- `apps/api` serving `GET /health`.
- `apps/web` rendering an empty layout with Tailwind working.

**Acceptance:** `pnpm dev` starts Postgres, API on `:3001`, web on `:3000`. `pnpm build` and `pnpm lint` pass across the workspace.

### Phase 1 — Schema and seed

- Full schema from section 4 in Drizzle, migration generated and applied.
- `packages/db/src/seed.ts` creating: one admin user (`admin@local`, password from `SEED_ADMIN_PASSWORD`), three environments (`dev` rank 0, `qa` rank 1, `prod` rank 2 protected), one developer user with `read`/`write`/`toggle`/`promote` on dev and qa and `read` on prod.

**Acceptance:** `pnpm db:migrate && pnpm db:seed` runs clean against an empty database and is idempotent on re-run.

### Phase 2 — Core domain

- Implement everything in section 6. No HTTP yet.
- Vitest integration tests against a real Postgres covering: type validation for all four types; flag creation producing correct `flag_environment` rows; promotion guard rejecting a skip from dev to prod; promotion copying the value from the correct source environment; promotion not enabling; `can()` for admin bypass and each developer permission; `buildEvaluationPayload` resolution matrix including disabled-returns-default and client-safe filtering.

**Acceptance:** all domain rules in section 5 have at least one passing test each, including the negative case.

### Phase 3 — Management API

- Session auth (login, logout, me) with argon2 and opaque tokens hashed in `session`.
- All routes from section 7.2.
- Central error handler mapping `DomainError` codes to statuses.
- Zod request validation from `packages/contracts`.

**Acceptance:** a documented curl script walks the full happy path — log in as developer, create a flag in dev, set its value, enable it, promote to qa, fail to promote to prod (403), log in as admin, promote to prod, disable it. Every step returns the expected status. Audit log contains one row per mutation.

### Phase 4 — Evaluation API

- SDK key middleware, `GET /v1/flags`, `GET /v1/config-version`, ETag and 304, in-memory cache, throttled `last_used_at`.

**Acceptance:** a dev key and a prod key return different payloads for the same flag set. A client key omits non-client-safe flags. A second request with `If-None-Match` returns 304. Any mutation through the management API changes the ETag on the next request.

### Phase 5 — Dashboard core

- API client with cookie forwarding from Server Components.
- Login page, flag matrix, flag detail with per-type value editors, promote and toggle actions, protected-environment confirmation.

**Acceptance:** the entire Phase 3 curl walkthrough is reproducible through the UI, and permission-gated controls are visibly disabled with an explanatory tooltip for the developer user on prod.

### Phase 6 — Admin surfaces

- Environments (including reorder with validation), API keys, team and permission grid, audit view.

**Acceptance:** an admin can add a `staging` environment between qa and prod, and existing promoted-in-prod flags block the reorder with a clear error listing them.

### Phase 7 — SDK

- `packages/sdk`: `createClient({ apiKey, baseUrl, pollInterval })` with in-memory cache, background ETag polling, `get(key)`, `getAll()`, and an `onChange` subscription.
- `ff-codegen` CLI reading the management API and emitting a `FlagMap` interface so `get()` return types narrow per key.
- README with a Node and a browser example.

**Acceptance:** in a scratch TypeScript file, `client.get('new-checkout')` type-checks as `boolean` and `client.get('max-cart-items')` as `number`, and assigning either to the wrong type fails compilation.

---

## 12. Conventions

- **Flag and environment keys** are the public identifiers in every management route. Never expose UUIDs in URLs.
- **Timestamps** serialize as ISO 8601 UTC strings.
- **Pagination** is cursor-based on `(created_at, id)`; responses include `{ items, nextCursor }`.
- **Transactions**: every domain mutation wraps in a single `db.transaction`. Audit and version bump go inside it.
- **No `any`.** `strict: true` everywhere. Drizzle inferred types flow through `packages/contracts`.
- **Tests** use a dedicated `feature_flags_test` database, truncated between test files.

## 13. Environment variables

```
DATABASE_URL=postgres://ff:ff@localhost:5432/feature_flags
API_PORT=3001
SESSION_SECRET=            # 32+ random bytes, used for cookie signing
SESSION_TTL_HOURS=168
SEED_ADMIN_EMAIL=admin@local
SEED_ADMIN_PASSWORD=
CORS_ORIGINS=http://localhost:3000
# apps/web
NEXT_PUBLIC_APP_NAME=Feature Flags
API_BASE_URL=http://localhost:3001
```

---

## 14. Design notes worth preserving

Two decisions carry most of the weight; if a later change appears to require breaking them, stop and reconsider the change instead.

**A flag's definition is global; its state is per-environment.** `flag` holds identity, type, and description exactly once. `flag_environment` holds promotion state, enabled state, and value. Promotion is therefore a state transition on an existing row, not a copy of a flag, which is why the flag key means the same thing in every environment.

**`state` and `enabled` are independent axes.** Promotion is structural and sequential and permissioned; enabling is instantaneous and reversible. This is what makes a production rollback a toggle rather than a deployment, and what allows a flag to sit in prod, off, for weeks before launch.

The `enabled + value` model is a strict subset of a targeting-rule system. When rules are eventually added, `flag_environment` gains a `rules jsonb` column and `payload.ts` gains a resolver — the wire format of `GET /v1/flags` does not change, so no SDK or consumer breaks.
