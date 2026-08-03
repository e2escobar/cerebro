import { Hono } from "hono";
import { openApiDocument } from "./openapi.ts";

/**
 * The document and a browsable reference for it.
 *
 * Both are public: they describe the shape of the API, not its contents, and a
 * developer needs to read them before they have any credentials to read with.
 */
export const docsRouter = new Hono();

docsRouter.get("/v1/openapi.json", (c) => c.json(openApiDocument));

docsRouter.get("/docs", (c) =>
  c.html(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cerebro API</title>
    <style>
      body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; }
      .fallback { max-width: 40rem; margin: 4rem auto; padding: 0 1.5rem; line-height: 1.6; }
      .fallback code { background: #eef1f6; padding: 0.15em 0.4em; border-radius: 4px; }
    </style>
  </head>
  <body>
    <noscript class="fallback">
      <h1>Cerebro API</h1>
      <p>
        The reference viewer needs JavaScript. The document itself is plain JSON at
        <code>/v1/openapi.json</code> and works in any OpenAPI tool.
      </p>
    </noscript>

    <div id="fallback" class="fallback">
      <h1>Cerebro API</h1>
      <p>
        Loading the reference. If it does not appear, this page renders it with
        Scalar from a CDN and cannot reach it — the document is always available
        at <code>/v1/openapi.json</code> and works in any OpenAPI tool.
      </p>
    </div>

    <!--
      proxyUrl is deliberately empty. Scalar will otherwise route "Test request"
      through its own proxy, which makes every call cross-origin and drops the
      cerebro_session cookie — so signing in from this page would appear to work
      and then every management call would 401.
    -->
    <script
      id="api-reference"
      data-url="/v1/openapi.json"
      data-configuration='{"theme":"deepSpace","hideDownloadButton":false,"proxyUrl":"","withCredentials":true}'
    ></script>
    <script
      src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"
      onload="document.getElementById('fallback')?.remove()"
    ></script>
  </body>
</html>`),
);
