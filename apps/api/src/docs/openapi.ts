import {
  createApiKeyRequest,
  createApplicationRequest,
  createEnvironmentRequest,
  createFlagRequest,
  createUserRequest,
  listAuditQuery,
  listFlagsQuery,
  loginRequest,
  reorderEnvironmentsRequest,
  setEnabledRequest,
  setPermissionsRequest,
  setValueRequest,
  updateApplicationRequest,
  updateEnvironmentRequest,
  updateFlagRequest,
  updateUserRequest,
} from "@cerebro/contracts";
import { STATUS_BY_CODE, type ErrorCode } from "@cerebro/core";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * The OpenAPI document, served at `/v1/openapi.json`.
 *
 * Request bodies and query strings are converted from the Zod schemas in
 * `@cerebro/contracts` — the same objects the handlers validate against, so
 * they cannot disagree. Response shapes are described here by hand.
 *
 * `test/openapi.test.ts` asserts this document and the router agree on which
 * paths exist, so a new route cannot ship undocumented.
 */

type JsonSchema = Record<string, unknown>;

function fromZod(schema: z.ZodTypeAny): JsonSchema {
  const converted = zodToJsonSchema(schema, {
    target: "openApi3",
    $refStrategy: "none",
  }) as JsonSchema;
  delete converted.$schema;
  return converted;
}

/** Each key of a query object becomes one query parameter. */
function queryParams(schema: z.ZodObject<z.ZodRawShape>): JsonSchema[] {
  return Object.entries(schema.shape).map(([name, field]) => ({
    name,
    in: "query",
    required: !field.isOptional(),
    schema: fromZod(field as z.ZodTypeAny),
  }));
}

function pathParams(...names: { name: string; description: string }[]): JsonSchema[] {
  return names.map(({ name, description }) => ({
    name,
    in: "path",
    required: true,
    description,
    schema: { type: "string" },
  }));
}

const APP_KEY_PARAM = {
  name: "appKey",
  description: "The application's key, e.g. `checkout`. Flags live inside one.",
};
const FLAG_KEY_PARAM = { name: "key", description: "The flag's key, e.g. `new-checkout`." };
const ENV_KEY_PARAM = { name: "envKey", description: "The environment's key, e.g. `prod`." };

function json(schema: JsonSchema | { $ref: string }, description: string): JsonSchema {
  return { description, content: { "application/json": { schema } } };
}

function ref(name: string) {
  return { $ref: `#/components/schemas/${name}` };
}

function body(schema: z.ZodTypeAny): JsonSchema {
  return { required: true, content: { "application/json": { schema: fromZod(schema) } } };
}

/** Shorthand for the error responses an operation can produce. */
function errors(...codes: ErrorCode[]): Record<string, JsonSchema> {
  const responses: Record<string, JsonSchema> = {};
  for (const code of codes) {
    const status = String(STATUS_BY_CODE[code]);
    const existing = responses[status]?.description as string | undefined;
    responses[status] = json(
      ref("Error"),
      existing ? `${existing}, \`${code}\`` : `\`${code}\``,
    );
  }
  return responses;
}

/* ── response schemas ──────────────────────────────────────────────────── */

const schemas: Record<string, JsonSchema> = {
  Error: {
    type: "object",
    required: ["error"],
    description:
      "Every failure uses this shape. `code` is the stable contract — it is safe to branch on, whereas `message` is written for people.",
    properties: {
      error: {
        type: "object",
        required: ["code", "message", "details"],
        properties: {
          code: { type: "string", example: "FLAG_NOT_PROMOTABLE" },
          message: { type: "string", example: "Flag must be promoted to 'qa' first" },
          details: { type: "object", additionalProperties: true },
        },
      },
    },
  },

  EvaluationPayload: {
    type: "object",
    additionalProperties: true,
    description:
      "A flat map of flag key to resolved value. A flag is present only where it is promoted, not archived, and — for a client key — marked client-safe. Every key present holds a value of its declared type, so consumers never handle `undefined`.",
    example: {
      "new-checkout": true,
      "max-cart-items": 50,
      "banner-copy": "Summer sale",
      "pricing-rules": { tier: "b", discount: 0.1 },
    },
  },

  ConfigVersion: {
    type: "object",
    required: ["version", "environment", "application"],
    properties: {
      version: { type: "integer", example: 42 },
      environment: { type: "string", example: "prod" },
      application: { type: "string", example: "checkout" },
    },
  },

  UserSummary: {
    type: "object",
    required: ["id", "name"],
    properties: { id: { type: "string", format: "uuid" }, name: { type: "string" } },
  },

  FlagEnvironment: {
    type: "object",
    description:
      "A flag's state in one environment. `state` and `enabled` are independent: promotion is structural and sequential, enabling is instantaneous and reversible.",
    properties: {
      key: { type: "string", example: "prod" },
      name: { type: "string" },
      rank: { type: "integer", description: "0 is the environment flags are created in." },
      state: { type: "string", enum: ["not_promoted", "promoted"] },
      enabled: { type: "boolean" },
      value: { description: "Any JSON value of the flag's declared type." },
      isProtected: { type: "boolean" },
      promotedAt: { type: ["string", "null"], format: "date-time" },
      firstEnabledAt: { type: ["string", "null"], format: "date-time" },
      updatedBy: { oneOf: [ref("UserSummary"), { type: "null" }] },
      updatedAt: { type: "string", format: "date-time" },
      canPromote: {
        type: "boolean",
        description: "Computed for the requesting user. Clients must render from this, not re-derive it.",
      },
      canToggle: { type: "boolean" },
      canWrite: { type: "boolean" },
    },
  },

  FlagDetail: {
    type: "object",
    properties: {
      applicationKey: { type: "string", example: "checkout" },
      key: { type: "string", example: "new-checkout" },
      name: { type: "string" },
      description: { type: "string" },
      type: { type: "string", enum: ["boolean", "string", "number", "json"] },
      defaultValue: { description: "Returned wherever the flag is switched off." },
      isClientSafe: { type: "boolean" },
      archivedAt: { type: ["string", "null"], format: "date-time" },
      createdBy: { oneOf: [ref("UserSummary"), { type: "null" }] },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      environments: { type: "array", items: ref("FlagEnvironment") },
      promotions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            fromEnv: { type: ["string", "null"], description: "null for the initial creation." },
            toEnv: { type: ["string", "null"] },
            actor: { type: ["string", "null"] },
            createdAt: { type: "string", format: "date-time" },
          },
        },
      },
      recentAudit: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            action: { type: "string" },
            environmentKey: { type: ["string", "null"] },
            actor: { type: ["string", "null"] },
            createdAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
  },

  FlagListItem: {
    type: "object",
    properties: {
      key: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      type: { type: "string", enum: ["boolean", "string", "number", "json"] },
      defaultValue: {},
      isClientSafe: { type: "boolean" },
      archivedAt: { type: ["string", "null"], format: "date-time" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      environments: {
        type: "array",
        description: "The per-environment matrix, in rank order.",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            rank: { type: "integer" },
            state: { type: "string", enum: ["not_promoted", "promoted"] },
            enabled: { type: "boolean" },
            value: {},
            updatedAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
  },

  Application: {
    type: "object",
    description:
      "Flags belong to exactly one application. The same key in two applications is two unrelated flags, each with its own type, default and per-environment state.",
    properties: {
      key: { type: "string", example: "checkout" },
      name: { type: "string" },
      description: { type: "string" },
      archivedAt: { type: ["string", "null"], format: "date-time" },
      createdAt: { type: "string", format: "date-time" },
      flagCount: { type: "integer", description: "Active flags it owns." },
    },
  },

  Environment: {
    type: "object",
    properties: {
      key: { type: "string", example: "prod" },
      name: { type: "string" },
      rank: { type: "integer" },
      isProtected: {
        type: "boolean",
        description:
          "Advisory: the dashboard demands a typed confirmation before writing here. It does not change API-level rules.",
      },
      createdAt: { type: "string", format: "date-time" },
    },
  },

  ApiKey: {
    type: "object",
    description: "The raw key is never included — only the displayable prefix.",
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      kind: { type: "string", enum: ["server", "client"] },
      prefix: { type: "string", example: "cbr_checkout_prod" },
      applicationKey: { type: "string" },
      environmentKey: { type: "string" },
      lastUsedAt: { type: ["string", "null"], format: "date-time" },
      revokedAt: { type: ["string", "null"], format: "date-time" },
      createdAt: { type: "string", format: "date-time" },
    },
  },

  CreatedApiKey: {
    allOf: [
      ref("ApiKey"),
      {
        type: "object",
        required: ["key"],
        properties: {
          key: {
            type: "string",
            example: "cbr_checkout_prod_9tKq2mR7wZxL4nB8vC1sD6fG0hJ3pQaE",
            description:
              "The raw key, returned exactly once. Cerebro stores only a hash — there is no endpoint that can return it again.",
          },
        },
      },
    ],
  },

  User: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string", enum: ["admin", "developer"] },
      disabledAt: { type: ["string", "null"], format: "date-time" },
      createdAt: { type: "string", format: "date-time" },
    },
  },

  PermissionGrants: {
    type: "object",
    required: ["grants"],
    properties: {
      grants: {
        type: "array",
        items: {
          type: "object",
          properties: {
            environmentKey: { type: "string" },
            permissions: {
              type: "array",
              items: { type: "string", enum: ["read", "write", "toggle", "promote"] },
            },
          },
        },
      },
    },
  },

  Me: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string", enum: ["admin", "developer"] },
      permissions: {
        type: "array",
        description: "Effective permissions per environment. Admins report all four everywhere.",
        items: {
          type: "object",
          properties: {
            environmentKey: { type: "string" },
            permissions: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  },

  AuditEntry: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      action: { type: "string", example: "flag.promoted" },
      entityType: {
        type: "string",
        enum: ["flag", "environment", "api_key", "user", "permission"],
      },
      entityId: { type: ["string", "null"], format: "uuid" },
      environmentKey: { type: ["string", "null"] },
      applicationKey: { type: ["string", "null"] },
      actor: {
        oneOf: [
          {
            type: "object",
            properties: { id: { type: "string" }, name: { type: ["string", "null"] } },
          },
          { type: "null" },
        ],
      },
      before: { description: "State before the change, or null." },
      after: { description: "State after the change, or null." },
      createdAt: { type: "string", format: "date-time" },
    },
  },
};

/** `{ items, nextCursor }` — cursor pagination on `(created_at, id)`. */
function paginated(itemRef: string): JsonSchema {
  return {
    type: "object",
    required: ["items", "nextCursor"],
    properties: {
      items: { type: "array", items: ref(itemRef) },
      nextCursor: {
        type: ["string", "null"],
        description: "Pass back as `cursor` for the next page. Null on the last page.",
      },
    },
  };
}

function list(itemRef: string): JsonSchema {
  return {
    type: "object",
    required: ["items"],
    properties: { items: { type: "array", items: ref(itemRef) } },
  };
}

const SESSION = [{ session: [] }];
const SDK_KEY = [{ sdkKey: [] }];

/**
 * Stable operation ids. Client generators turn these into method names, so
 * they are chosen rather than derived from the path — and changing one is a
 * breaking change for anyone generating a client.
 */
const OPERATION_IDS: Record<string, string> = {
  "get /health": "getHealth",
  "get /v1/openapi.json": "getOpenApiDocument",
  "get /docs": "getApiReference",

  "get /v1/flags": "evaluateFlags",
  "get /v1/config-version": "getConfigVersion",

  "post /v1/auth/login": "login",
  "post /v1/auth/logout": "logout",
  "get /v1/auth/me": "getCurrentUser",

  "get /v1/mgmt/applications": "listApplications",
  "post /v1/mgmt/applications": "createApplication",
  "patch /v1/mgmt/applications/{appKey}": "updateApplication",
  "delete /v1/mgmt/applications/{appKey}": "deleteApplication",

  "get /v1/mgmt/applications/{appKey}/flags": "listFlags",
  "post /v1/mgmt/applications/{appKey}/flags": "createFlag",
  "get /v1/mgmt/applications/{appKey}/flags/{key}": "getFlag",
  "patch /v1/mgmt/applications/{appKey}/flags/{key}": "updateFlag",
  "post /v1/mgmt/applications/{appKey}/flags/{key}/archive": "archiveFlag",
  "post /v1/mgmt/applications/{appKey}/flags/{key}/restore": "restoreFlag",
  "put /v1/mgmt/applications/{appKey}/flags/{key}/environments/{envKey}/value": "setFlagValue",
  "put /v1/mgmt/applications/{appKey}/flags/{key}/environments/{envKey}/enabled": "setFlagEnabled",
  "post /v1/mgmt/applications/{appKey}/flags/{key}/environments/{envKey}/promote": "promoteFlag",
  "delete /v1/mgmt/applications/{appKey}/flags/{key}/environments/{envKey}/promote": "demoteFlag",

  "get /v1/mgmt/environments": "listEnvironments",
  "post /v1/mgmt/environments": "createEnvironment",
  "put /v1/mgmt/environments/order": "reorderEnvironments",
  "patch /v1/mgmt/environments/{key}": "updateEnvironment",
  "delete /v1/mgmt/environments/{key}": "deleteEnvironment",

  "get /v1/mgmt/api-keys": "listApiKeys",
  "post /v1/mgmt/api-keys": "createApiKey",
  "delete /v1/mgmt/api-keys/{id}": "revokeApiKey",

  "get /v1/mgmt/users": "listUsers",
  "post /v1/mgmt/users": "createUser",
  "patch /v1/mgmt/users/{id}": "updateUser",
  "get /v1/mgmt/users/{id}/permissions": "getUserPermissions",
  "put /v1/mgmt/users/{id}/permissions": "setUserPermissions",

  "get /v1/mgmt/audit": "listAudit",
};

/** Injects the operation ids, and refuses to build a document missing one. */
function withOperationIds<T extends { paths: Record<string, Record<string, unknown>> }>(
  document: T,
): T {
  const methods = ["get", "post", "put", "patch", "delete"];

  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of methods) {
      const operation = item[method] as Record<string, unknown> | undefined;
      if (!operation) continue;

      const id = OPERATION_IDS[`${method} ${path}`];
      if (!id) throw new Error(`No operationId defined for ${method.toUpperCase()} ${path}`);
      operation.operationId = id;
    }
  }

  return document;
}

export const openApiDocument = withOperationIds({
  openapi: "3.1.0",

  info: {
    title: "Cerebro",
    version: "1.0.0",
    description: [
      "Feature flags, promoted through an ordered pipeline.",
      "",
      "There are two independent APIs here.",
      "",
      "**Evaluation** is what your applications call. It is authenticated by an",
      "environment-scoped SDK key and returns a flat key-value map. The environment",
      "is derived from the key and never from a path or query parameter.",
      "",
      "**Management** is what the dashboard calls. It is authenticated by a session",
      "cookie and exposes full metadata. Flag and environment keys are the public",
      "identifiers throughout — UUIDs never appear in URLs.",
      "",
      "### Two ideas worth knowing before you start",
      "",
      "A flag's definition is global; its state is per-environment. Promotion is a",
      "state transition on an existing row, not a copy, which is why a flag key means",
      "the same thing everywhere.",
      "",
      "`state` and `enabled` are independent. Promotion is structural, sequential and",
      "permissioned; enabling is instantaneous and reversible. That is what makes a",
      "production rollback a toggle rather than a deployment.",
    ].join("\n"),
  },

  servers: [{ url: "http://localhost:3011", description: "Local development" }],

  tags: [
    { name: "Evaluation", description: "What your applications call. SDK key required." },
    { name: "Applications", description: "Flags belong to one. Admin-managed." },
    { name: "Auth", description: "Session login for the management API." },
    { name: "Flags", description: "Create, edit, promote and toggle flags." },
    { name: "Environments", description: "The promotion pipeline. Admin only, except reads." },
    { name: "API keys", description: "SDK keys, scoped to one environment. Admin only." },
    { name: "People", description: "Users and per-environment permissions. Admin only." },
    { name: "Audit", description: "Every mutation, in order." },
    { name: "Meta", description: "Health and this document." },
  ],

  components: {
    securitySchemes: {
      sdkKey: {
        type: "http",
        scheme: "bearer",
        description:
          "**Evaluation endpoints only** — `GET /v1/flags` and `GET /v1/config-version`. An SDK key will never authenticate a `/v1/mgmt/…` route; those use the `cerebro_session` cookie, which you get by calling `POST /v1/auth/login` from this page. Format: `Authorization: Bearer cbr_<app>_<env>_…`, created under Keys in the dashboard.",
      },
      session: {
        type: "apiKey",
        in: "cookie",
        name: "cerebro_session",
        description:
          "**Every `/v1/mgmt/…` route.** There is nothing to paste here: call `POST /v1/auth/login` from this page and the browser stores the cookie and sends it automatically from then on. It is httpOnly, so no tool can set it by hand.",
      },
    },
    schemas,
  },

  paths: {
    "/health": {
      get: {
        tags: ["Meta"],
        summary: "Liveness check",
        security: [],
        responses: {
          200: json(
            { type: "object", properties: { status: { type: "string" }, service: { type: "string" } } },
            "The server is up.",
          ),
        },
      },
    },

    "/v1/openapi.json": {
      get: {
        tags: ["Meta"],
        summary: "This document",
        security: [],
        responses: { 200: json({ type: "object" }, "The OpenAPI document.") },
      },
    },

    "/docs": {
      get: {
        tags: ["Meta"],
        summary: "Browsable API reference",
        security: [],
        responses: { 200: { description: "An HTML page rendering this document." } },
      },
    },

    /* ── evaluation ──────────────────────────────────────────────────── */

    "/v1/flags": {
      get: {
        tags: ["Evaluation"],
        security: SDK_KEY,
        summary: "Every flag this key can see",
        description: [
          "**There is nothing to pass.** The application and the environment both come from the key itself — never from a path, a query parameter or a header. To read a different application or environment, use a key issued for that pair.",
          "",
          "That is the point: your code names no environment, so the same build runs in dev, qa and prod with only the key changing. And a client key that ships to browsers cannot be edited by whoever finds it to read production, or another application's flags.",
          "",
          "Not sure what a key resolves to? `GET /v1/config-version` answers it.",
          "",
          "Send `If-None-Match` with the previous `ETag` and an unchanged payload costs a `304`.",
          "",
          "The SDK polls this every 30 seconds by default, so a change reaches consumers within one interval — no deploy, no restart.",
        ].join("\n"),
        parameters: [
          {
            name: "If-None-Match",
            in: "header",
            required: false,
            schema: { type: "string" },
            example: 'W/"prod-42"',
          },
        ],
        responses: {
          200: {
            ...json(ref("EvaluationPayload"), "The current flags for this key's environment."),
            headers: {
              ETag: {
                schema: { type: "string" },
                description: 'Weak tag: `W/"<app>-<env>-<version>"`. Versions are per application, so another team\'s release never invalidates your cache.',
              },
              "Cache-Control": { schema: { type: "string" }, description: "`public, max-age=30`" },
              "X-Config-Version": { schema: { type: "integer" } },
            },
          },
          304: { description: "Nothing has changed since the ETag you sent. No body." },
          ...errors("UNAUTHENTICATED"),
        },
      },
    },

    "/v1/config-version": {
      get: {
        tags: ["Evaluation"],
        security: SDK_KEY,
        summary: "Current payload version",
        description: [
          "A cheap poll target when you only want to know whether anything moved.",
          "",
          "Also the quickest way to see what a key resolves to: the response names the application and environment it is bound to. Useful when a payload is emptier than you expected.",
        ].join("\n"),
        responses: {
          200: json(ref("ConfigVersion"), "The environment and its config version."),
          ...errors("UNAUTHENTICATED"),
        },
      },
    },

    /* ── auth ────────────────────────────────────────────────────────── */

    "/v1/auth/login": {
      post: {
        tags: ["Auth"],
        security: [],
        summary: "Sign in",
        description: "Sets the `cerebro_session` cookie. Wrong password and unknown email are indistinguishable, by design.",
        requestBody: body(loginRequest),
        responses: {
          200: json(ref("User"), "Signed in. The session cookie is set."),
          ...errors("VALIDATION_FAILED", "UNAUTHENTICATED"),
        },
      },
    },

    "/v1/auth/logout": {
      post: {
        tags: ["Auth"],
        security: SESSION,
        summary: "Sign out",
        description: "Deletes the session server-side and clears the cookie. Safe to call when already signed out.",
        responses: { 200: json({ type: "object" }, "Signed out.") },
      },
    },

    "/v1/auth/me": {
      get: {
        tags: ["Auth"],
        security: SESSION,
        summary: "Who am I, and what may I do",
        responses: { 200: json(ref("Me"), "The current user and their effective permissions."), ...errors("UNAUTHENTICATED") },
      },
    },

    /* ── flags ───────────────────────────────────────────────────────── */

    "/v1/mgmt/applications/{appKey}/flags": {
      get: {
        tags: ["Flags"],
        security: SESSION,
        summary: "List flags with their environment matrix",
        parameters: [...pathParams(APP_KEY_PARAM), ...queryParams(listFlagsQuery)],
        responses: {
          200: json(paginated("FlagListItem"), "A page of flags."),
          ...errors("UNAUTHENTICATED", "VALIDATION_FAILED"),
        },
      },
      post: {
        tags: ["Flags"],
        security: SESSION,
        summary: "Create a flag",
        parameters: pathParams(APP_KEY_PARAM),
        description: [
          "Created in the rank-0 environment, promoted there and switched off. Every other environment gets a `not_promoted` row holding the default value.",
          "",
          "`type` is fixed at creation — there is no endpoint to change it.",
          "",
          "Requires `write` on the rank-0 environment.",
        ].join("\n"),
        requestBody: body(createFlagRequest),
        responses: {
          201: json(ref("FlagDetail"), "The created flag."),
          ...errors("VALIDATION_FAILED", "INVALID_FLAG_VALUE", "UNAUTHENTICATED", "FORBIDDEN", "FLAG_KEY_TAKEN"),
        },
      },
    },

    "/v1/mgmt/applications/{appKey}/flags/{key}": {
      get: {
        tags: ["Flags"],
        security: SESSION,
        summary: "One flag, in full",
        description: "Includes the per-environment matrix with `canPromote` / `canToggle` / `canWrite` computed for you, promotion history, and recent audit.",
        parameters: pathParams(APP_KEY_PARAM, FLAG_KEY_PARAM),
        responses: {
          200: json(ref("FlagDetail"), "The flag."),
          ...errors("UNAUTHENTICATED", "FORBIDDEN", "FLAG_NOT_FOUND"),
        },
      },
      patch: {
        tags: ["Flags"],
        security: SESSION,
        summary: "Edit the key, name, description or client-safety",
        description: [
          "`type` is immutable and is ignored if sent.",
          "",
          "Changing `key` or `isClientSafe` moves every environment's config version, because both change the payload itself rather than one environment's copy of it. A rename is a breaking change: anything still asking for the old key receives nothing and falls back to its own default. It needs admin, or `write` on rank 0 with the flag unpromoted above it — the same guard as archiving.",
          "",
          "The response carries the new key, which is where the flag lives from now on.",
        ].join("\n"),
        parameters: pathParams(APP_KEY_PARAM, FLAG_KEY_PARAM),
        requestBody: body(updateFlagRequest),
        responses: {
          200: json(ref("FlagDetail"), "The updated flag."),
          ...errors("VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "FLAG_NOT_FOUND", "FLAG_KEY_TAKEN", "FLAG_ARCHIVED"),
        },
      },
    },

    "/v1/mgmt/applications/{appKey}/flags/{key}/archive": {
      post: {
        tags: ["Flags"],
        security: SESSION,
        summary: "Archive a flag",
        description: "It disappears from every environment's payload immediately. Requires admin, or `write` on rank 0 with the flag unpromoted above it.",
        parameters: pathParams(APP_KEY_PARAM, FLAG_KEY_PARAM),
        responses: {
          200: json(ref("FlagDetail"), "The archived flag."),
          ...errors("UNAUTHENTICATED", "FORBIDDEN", "FLAG_NOT_FOUND", "FLAG_ARCHIVED"),
        },
      },
    },

    "/v1/mgmt/applications/{appKey}/flags/{key}/restore": {
      post: {
        tags: ["Flags"],
        security: SESSION,
        summary: "Restore an archived flag",
        parameters: pathParams(APP_KEY_PARAM, FLAG_KEY_PARAM),
        responses: {
          200: json(ref("FlagDetail"), "The restored flag."),
          ...errors("UNAUTHENTICATED", "FORBIDDEN", "FLAG_NOT_FOUND", "FLAG_NOT_ARCHIVED"),
        },
      },
    },

    "/v1/mgmt/applications/{appKey}/flags/{key}/environments/{envKey}/value": {
      put: {
        tags: ["Flags"],
        security: SESSION,
        summary: "Set the value in one environment",
        description: "Validated against the flag's declared type. Invisible to consumers until the flag is switched on here. Requires `write` on this environment.",
        parameters: pathParams(APP_KEY_PARAM, FLAG_KEY_PARAM, ENV_KEY_PARAM),
        requestBody: body(setValueRequest),
        responses: {
          200: json(ref("FlagDetail"), "The updated flag."),
          ...errors("INVALID_FLAG_VALUE", "UNAUTHENTICATED", "FORBIDDEN", "FLAG_NOT_FOUND", "ENVIRONMENT_NOT_FOUND", "FLAG_ARCHIVED"),
        },
      },
    },

    "/v1/mgmt/applications/{appKey}/flags/{key}/environments/{envKey}/enabled": {
      put: {
        tags: ["Flags"],
        security: SESSION,
        summary: "Switch a flag on or off",
        description: "The kill switch. Moves in either direction with no ordering constraint, but only where the flag has been promoted. Requires `toggle` on this environment.",
        parameters: pathParams(APP_KEY_PARAM, FLAG_KEY_PARAM, ENV_KEY_PARAM),
        requestBody: body(setEnabledRequest),
        responses: {
          200: json(ref("FlagDetail"), "The updated flag."),
          ...errors("VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "FLAG_NOT_FOUND", "NOT_PROMOTED", "FLAG_ARCHIVED"),
        },
      },
    },

    "/v1/mgmt/applications/{appKey}/flags/{key}/environments/{envKey}/promote": {
      post: {
        tags: ["Flags"],
        security: SESSION,
        summary: "Promote into the next environment",
        description: [
          "Copies the value from the highest promoted environment below the target and arrives **switched off**. Promotion makes a flag available; it never enables it.",
          "",
          "The flag must already be promoted in every lower-ranked environment — you cannot skip. Requires `promote` on the target.",
        ].join("\n"),
        parameters: pathParams(APP_KEY_PARAM, FLAG_KEY_PARAM, ENV_KEY_PARAM),
        responses: {
          200: json(ref("FlagDetail"), "The promoted flag."),
          ...errors("UNAUTHENTICATED", "FORBIDDEN", "FLAG_NOT_FOUND", "ALREADY_PROMOTED", "FLAG_NOT_PROMOTABLE", "CANNOT_PROMOTE_INTO_BASE_ENVIRONMENT", "FLAG_ARCHIVED"),
        },
      },
      delete: {
        tags: ["Flags"],
        security: SESSION,
        summary: "Demote out of an environment",
        description: "Admin only, and blocked while the flag is promoted anywhere higher. The flag leaves that environment's payload entirely.",
        parameters: pathParams(APP_KEY_PARAM, FLAG_KEY_PARAM, ENV_KEY_PARAM),
        responses: {
          200: json(ref("FlagDetail"), "The demoted flag."),
          ...errors("UNAUTHENTICATED", "FORBIDDEN", "FLAG_NOT_FOUND", "NOT_PROMOTED", "PROMOTED_IN_HIGHER_ENVIRONMENT"),
        },
      },
    },

    /* ── applications ────────────────────────────────────────────────── */

    "/v1/mgmt/applications": {
      get: {
        tags: ["Applications"],
        security: SESSION,
        summary: "List applications",
        description: "Readable by every signed-in user — you cannot choose where to work otherwise.",
        responses: { 200: json(list("Application"), "Applications, by key."), ...errors("UNAUTHENTICATED") },
      },
      post: {
        tags: ["Applications"],
        security: SESSION,
        summary: "Create an application",
        description: "Admin only. It must exist before anyone can create a flag in it.",
        requestBody: body(createApplicationRequest),
        responses: {
          201: json(ref("Application"), "The created application."),
          ...errors("VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "APPLICATION_KEY_TAKEN"),
        },
      },
    },

    "/v1/mgmt/applications/{appKey}": {
      patch: {
        tags: ["Applications"],
        security: SESSION,
        summary: "Rename or redescribe an application",
        description: "Admin only. The key is permanent — it appears in every SDK key issued for it.",
        parameters: pathParams(APP_KEY_PARAM),
        requestBody: body(updateApplicationRequest),
        responses: {
          200: json(ref("Application"), "The updated application."),
          ...errors("VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "APPLICATION_NOT_FOUND"),
        },
      },
      delete: {
        tags: ["Applications"],
        security: SESSION,
        summary: "Delete an application",
        description:
          "Admin only, and refused while it still owns active flags. Archive them first; its archived flags and API keys are deleted with it.",
        parameters: pathParams(APP_KEY_PARAM),
        responses: {
          200: json({ type: "object" }, "Deleted."),
          ...errors("UNAUTHENTICATED", "FORBIDDEN", "APPLICATION_NOT_FOUND", "APPLICATION_IN_USE"),
        },
      },
    },

    /* ── environments ────────────────────────────────────────────────── */

    "/v1/mgmt/environments": {
      get: {
        tags: ["Environments"],
        security: SESSION,
        summary: "List environments in pipeline order",
        description: "Readable by any signed-in user.",
        responses: { 200: json(list("Environment"), "Environments, lowest rank first."), ...errors("UNAUTHENTICATED") },
      },
      post: {
        tags: ["Environments"],
        security: SESSION,
        summary: "Add an environment",
        description: "Admin only. Backfills a `not_promoted` row for every existing flag.",
        requestBody: body(createEnvironmentRequest),
        responses: {
          201: json(ref("Environment"), "The created environment."),
          ...errors("VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "ENVIRONMENT_KEY_TAKEN", "ENVIRONMENT_RANK_TAKEN"),
        },
      },
    },

    "/v1/mgmt/environments/order": {
      put: {
        tags: ["Environments"],
        security: SESSION,
        summary: "Reorder the pipeline",
        description: "Admin only. Send every environment key exactly once. Refused — with the offending flags named in `details.violations` — if the new order would leave a flag promoted above an environment it has not reached.",
        requestBody: body(reorderEnvironmentsRequest),
        responses: {
          200: json(list("Environment"), "The new order."),
          ...errors("VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "INVALID_ENVIRONMENT_ORDER"),
        },
      },
    },

    "/v1/mgmt/environments/{key}": {
      patch: {
        tags: ["Environments"],
        security: SESSION,
        summary: "Rename or protect an environment",
        parameters: pathParams({ name: "key", description: "The environment's key." }),
        requestBody: body(updateEnvironmentRequest),
        responses: {
          200: json(ref("Environment"), "The updated environment."),
          ...errors("VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "ENVIRONMENT_NOT_FOUND"),
        },
      },
      delete: {
        tags: ["Environments"],
        security: SESSION,
        summary: "Delete an environment",
        description: "Admin only, and refused while any flag is promoted there. Its API keys go with it.",
        parameters: pathParams({ name: "key", description: "The environment's key." }),
        responses: {
          200: json({ type: "object" }, "Deleted."),
          ...errors("UNAUTHENTICATED", "FORBIDDEN", "ENVIRONMENT_NOT_FOUND", "ENVIRONMENT_IN_USE"),
        },
      },
    },

    /* ── api keys ────────────────────────────────────────────────────── */

    "/v1/mgmt/api-keys": {
      get: {
        tags: ["API keys"],
        security: SESSION,
        summary: "List keys",
        description: "Admin only. Never includes the raw key.",
        responses: { 200: json(list("ApiKey"), "All keys, newest first."), ...errors("UNAUTHENTICATED", "FORBIDDEN") },
      },
      post: {
        tags: ["API keys"],
        security: SESSION,
        summary: "Create a key",
        description: "Admin only. The response is the **only** time the raw key exists — Cerebro stores a hash. A `client` key is public and receives only client-safe flags.",
        requestBody: body(createApiKeyRequest),
        responses: {
          201: json(ref("CreatedApiKey"), "The new key, including its raw value."),
          ...errors("VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "ENVIRONMENT_NOT_FOUND"),
        },
      },
    },

    "/v1/mgmt/api-keys/{id}": {
      delete: {
        tags: ["API keys"],
        security: SESSION,
        summary: "Revoke a key",
        description: "Admin only. Takes effect on the next request that uses it.",
        parameters: pathParams({ name: "id", description: "The key's id." }),
        responses: {
          200: json({ type: "object" }, "Revoked."),
          ...errors("UNAUTHENTICATED", "FORBIDDEN", "API_KEY_NOT_FOUND"),
        },
      },
    },

    /* ── people ──────────────────────────────────────────────────────── */

    "/v1/mgmt/users": {
      get: {
        tags: ["People"],
        security: SESSION,
        summary: "List people",
        responses: { 200: json(list("User"), "Everyone, oldest first."), ...errors("UNAUTHENTICATED", "FORBIDDEN") },
      },
      post: {
        tags: ["People"],
        security: SESSION,
        summary: "Add a person",
        description: "Admin only. Set a temporary password and pass it on.",
        requestBody: body(createUserRequest),
        responses: {
          201: json(ref("User"), "The new person."),
          ...errors("VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "USER_EMAIL_TAKEN"),
        },
      },
    },

    "/v1/mgmt/users/{id}": {
      patch: {
        tags: ["People"],
        security: SESSION,
        summary: "Change name, role, password or disable",
        description: "Admin only. Disabling ends their sessions and keeps their audit history.",
        parameters: pathParams({ name: "id", description: "The person's id." }),
        requestBody: body(updateUserRequest),
        responses: {
          200: json(ref("User"), "The updated person."),
          ...errors("VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "USER_NOT_FOUND"),
        },
      },
    },

    "/v1/mgmt/users/{id}/permissions": {
      get: {
        tags: ["People"],
        security: SESSION,
        summary: "Read someone's grants",
        parameters: pathParams({ name: "id", description: "The person's id." }),
        responses: { 200: json(ref("PermissionGrants"), "Their grants, per environment."), ...errors("UNAUTHENTICATED", "FORBIDDEN") },
      },
      put: {
        tags: ["People"],
        security: SESSION,
        summary: "Replace someone's grants",
        description: "Admin only. This is a **full replace** — anything you leave out is revoked. Admins ignore grants entirely; they can do everything everywhere.",
        parameters: pathParams({ name: "id", description: "The person's id." }),
        requestBody: body(setPermissionsRequest),
        responses: {
          200: json(ref("PermissionGrants"), "Their grants after the change."),
          ...errors("VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "USER_NOT_FOUND", "ENVIRONMENT_NOT_FOUND"),
        },
      },
    },

    /* ── audit ───────────────────────────────────────────────────────── */

    "/v1/mgmt/audit": {
      get: {
        tags: ["Audit"],
        security: SESSION,
        summary: "Every mutation, newest first",
        description: "Readable by any signed-in user. Each row records who, what, where and the before/after.",
        parameters: queryParams(listAuditQuery),
        responses: {
          200: json(paginated("AuditEntry"), "A page of audit entries."),
          ...errors("VALIDATION_FAILED", "UNAUTHENTICATED"),
        },
      },
    },
  },
});

export type OpenApiDocument = typeof openApiDocument;
