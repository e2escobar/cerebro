import { describe, expect, test } from "bun:test";
import { app } from "../src/index.ts";
import { openApiDocument } from "../src/docs/openapi.ts";

/**
 * The document is written beside the router rather than derived from it, so
 * these tests are what stop the two drifting apart: a new route cannot ship
 * undocumented, and a documented path cannot outlive its route.
 */

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

interface JsonValue {
  pattern?: string;
  enum?: string[];
}

interface Operation {
  description?: string;
  responses: Record<string, unknown>;
  requestBody?: unknown;
}

const paths = openApiDocument.paths as Record<string, Record<string, Operation>>;

function operationAt(path: string, method: string): Operation {
  const operation = paths[path]?.[method];
  if (!operation) throw new Error(`${method.toUpperCase()} ${path} is not in the document`);
  return operation;
}

/** Hono says `/flags/:key`; OpenAPI says `/flags/{key}`. */
function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function registeredOperations(): Set<string> {
  const operations = new Set<string>();
  for (const route of app.routes) {
    // `ALL` entries are middleware (cors, session, requireAdmin), not endpoints.
    if (route.method === "ALL") continue;
    operations.add(`${route.method.toLowerCase()} ${toOpenApiPath(route.path)}`);
  }
  return operations;
}

function documentedOperations(): Set<string> {
  const operations = new Set<string>();
  for (const [path, item] of Object.entries(openApiDocument.paths)) {
    for (const method of Object.keys(item)) {
      if (HTTP_METHODS.has(method)) operations.add(`${method} ${path}`);
    }
  }
  return operations;
}

describe("the OpenAPI document and the router agree", () => {
  test("every route the server serves is documented", () => {
    const undocumented = [...registeredOperations()].filter(
      (operation) => !documentedOperations().has(operation),
    );
    expect(undocumented).toEqual([]);
  });

  test("every documented path is a route the server actually serves", () => {
    const phantom = [...documentedOperations()].filter(
      (operation) => !registeredOperations().has(operation),
    );
    expect(phantom).toEqual([]);
  });

  test("the comparison is not vacuous", () => {
    // Guards against both sets being empty and the checks above passing trivially.
    expect(registeredOperations().size).toBeGreaterThan(25);
    expect(documentedOperations().size).toBe(registeredOperations().size);
  });
});

describe("the document is usable", () => {
  test("is served as JSON and declares OpenAPI 3.1", async () => {
    const response = await app.request("/v1/openapi.json");
    expect(response.status).toBe(200);

    const document = (await response.json()) as { openapi: string; info: { title: string } };
    expect(document.openapi).toBe("3.1.0");
    expect(document.info.title).toBe("Cerebro");
  });

  test("needs no credentials — you read it before you have any", async () => {
    expect((await app.request("/v1/openapi.json")).status).toBe(200);
    expect((await app.request("/docs")).status).toBe(200);
  });

  test("declares both authentication schemes", () => {
    const schemes = openApiDocument.components.securitySchemes;
    expect(schemes.sdkKey.scheme).toBe("bearer");
    expect(schemes.session.name).toBe("cerebro_session");
  });

  test("every $ref resolves to a defined schema", () => {
    const serialized = JSON.stringify(openApiDocument);
    const referenced = [...serialized.matchAll(/"#\/components\/schemas\/([A-Za-z]+)"/g)].map(
      (match) => match[1] as string,
    );
    const defined = new Set(Object.keys(openApiDocument.components.schemas));

    const dangling = [...new Set(referenced)].filter((name) => !defined.has(name));
    expect(dangling).toEqual([]);
  });

  test("every operation has a stable operationId, so clients can be generated", () => {
    const ids: string[] = [];
    for (const item of Object.values(openApiDocument.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (!HTTP_METHODS.has(method)) continue;
        const id = (operation as { operationId?: string }).operationId;
        expect(id).toBeString();
        ids.push(id as string);
      }
    }
    // Duplicated ids would collide as method names in a generated client.
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("request bodies come from the Zod contracts, so they carry real constraints", () => {
    const create = operationAt("/v1/mgmt/applications/{appKey}/flags", "post");
    const schema = (
      create.requestBody as {
        content: Record<string, { schema: { properties: Record<string, JsonValue> } }>;
      }
    ).content["application/json"]?.schema;

    // Straight from FLAG_KEY and flagTypeSchema in @cerebro/contracts.
    expect(schema?.properties.key?.pattern).toBe("^[a-z][a-z0-9-]{1,63}$");
    expect(schema?.properties.type?.enum).toEqual(["boolean", "string", "number", "json"]);
  });

  test("documents the promotion rules that are easy to get wrong", () => {
    const promote = operationAt("/v1/mgmt/applications/{appKey}/flags/{key}/environments/{envKey}/promote", "post");

    expect(promote.description).toContain("switched off");
    expect(promote.description).toContain("cannot skip");
    // 422 for the sequencing rule, 403 for the missing permission — different things.
    expect(Object.keys(promote.responses)).toContain("422");
    expect(Object.keys(promote.responses)).toContain("403");
  });
});
