/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  hrefFromAnchor,
  isHttpOrHttpsUrl,
  parseHttpUrl,
  shouldInterceptAnchorClick,
} from "./url.ts";

describe("parseHttpUrl", () => {
  it("accepts http and https URLs", () => {
    expect(parseHttpUrl("https://example.com/path").href).toBe(
      "https://example.com/path",
    );
    expect(isHttpOrHttpsUrl("http://localhost:3000")).toBe(true);
  });

  it("rejects other schemes", () => {
    expect(() => parseHttpUrl("mailto:aj@example.com")).toThrow(/http or https/);
    expect(() => parseHttpUrl("/threads/thr_1")).toThrow(/http or https/);
  });
});

describe("shouldInterceptAnchorClick", () => {
  it("ignores modified and non-primary clicks", () => {
    expect(
      shouldInterceptAnchorClick(
        new MouseEvent("click", { button: 0, metaKey: true }),
      ),
    ).toBe(false);
    expect(
      shouldInterceptAnchorClick(new MouseEvent("click", { button: 1 })),
    ).toBe(false);
    expect(
      shouldInterceptAnchorClick(new MouseEvent("click", { button: 0 })),
    ).toBe(true);
  });
});

describe("hrefFromAnchor", () => {
  it("keeps same-origin and non-http links on the page", () => {
    const sameOrigin = document.createElement("a");
    sameOrigin.href = `${window.location.origin}/threads/thr_1`;
    expect(hrefFromAnchor(sameOrigin)).toBeNull();

    const mailto = document.createElement("a");
    mailto.setAttribute("href", "mailto:aj@example.com");
    expect(hrefFromAnchor(mailto)).toBeNull();
  });

  it("returns absolute http(s) destinations", () => {
    const link = document.createElement("a");
    link.href = "https://github.com/get-bb/bb";
    expect(hrefFromAnchor(link)).toBe("https://github.com/get-bb/bb");
  });
});
