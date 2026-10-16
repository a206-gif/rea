import { describe, expect, it } from "vitest";
import { adapterFor, isAllowedSiteUrl } from "./site-adapters";

describe("site adapter URL admission", () => {
  it("admits configured HTTPS hosts and subdomains", () => {
    const adapter = adapterFor("doubao");
    expect(isAllowedSiteUrl(adapter, "https://www.doubao.com/")).toBe(true);
    expect(isAllowedSiteUrl(adapter, "https://studio.doubao.com/create")).toBe(true);
  });

  it("rejects lookalike hosts and non-HTTPS schemes", () => {
    const adapter = adapterFor("dola");
    expect(isAllowedSiteUrl(adapter, "https://dola.com.attacker.example/")).toBe(false);
    expect(isAllowedSiteUrl(adapter, "http://www.dola.com/")).toBe(false);
    expect(isAllowedSiteUrl(adapter, "javascript:alert(1)")).toBe(false);
  });

  it("requires an exact local demo URL", () => {
    const adapter = adapterFor("demo");
    expect(isAllowedSiteUrl(adapter, adapter.baseUrl)).toBe(true);
    expect(isAllowedSiteUrl(adapter, `${adapter.baseUrl}/other`)).toBe(false);
  });
});
