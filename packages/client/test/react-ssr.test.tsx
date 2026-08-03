import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { FlagManifest } from "../src/index";
import { CerebroProvider, useFlag, useFlagsReady } from "../src/react/index";
import { stubApi, TEST_KEY } from "./stub-api";

/**
 * Server rendering needs no DOM, and it exercises the part of the React
 * binding that is easiest to get wrong: `getServerSnapshot`. Without it React
 * throws here, and if it returned anything other than the values that were
 * serialized into the HTML, hydration would mismatch.
 */

const manifest: FlagManifest = {
  version: 1,
  application: "checkout",
  generatedAt: "2026-08-03T00:00:00.000Z",
  flags: {
    "new-checkout": { type: "boolean", default: false },
    "max-cart-items": { type: "number", default: 20 },
  },
};

function Probe() {
  const enabled = useFlag("new-checkout");
  const limit = useFlag("max-cart-items");
  const ready = useFlagsReady();
  return (
    <span>
      {String(enabled)}/{String(limit)}/{String(ready)}
    </span>
  );
}

describe("server rendering", () => {
  test("renders the server snapshot without fetching", () => {
    const api = stubApi({ "new-checkout": false, "max-cart-items": 1 });

    const html = renderToStaticMarkup(
      <CerebroProvider
        apiKey={TEST_KEY}
        baseUrl="http://flags.test"
        fetch={api.fetch}
        manifest={manifest}
        snapshot={{ "new-checkout": true, "max-cart-items": 50 }}
      >
        <Probe />
      </CerebroProvider>,
    );

    expect(html).toBe("<span>true/50/true</span>");
    // Effects do not run on the server, so nothing was requested — the markup
    // is the snapshot it was handed, not a race with the network.
    expect(api.calls).toHaveLength(0);
  });

  test("falls back to manifest defaults with no snapshot at all", () => {
    const html = renderToStaticMarkup(
      <CerebroProvider manifest={manifest} snapshot={{}}>
        <Probe />
      </CerebroProvider>,
    );

    expect(html).toBe("<span>false/20/false</span>");
  });

  test("local defaults beat the manifest", () => {
    const html = renderToStaticMarkup(
      <CerebroProvider manifest={manifest} snapshot={{}} defaults={{ "max-cart-items": 5 }}>
        <Probe />
      </CerebroProvider>,
    );

    expect(html).toBe("<span>false/5/false</span>");
  });

  test("a hook outside the provider says so", () => {
    function Orphan() {
      return <span>{String(useFlag("new-checkout"))}</span>;
    }

    expect(() => renderToStaticMarkup(<Orphan />)).toThrow(/CerebroProvider/);
  });
});
