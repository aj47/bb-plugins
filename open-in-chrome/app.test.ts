/**
 * @vitest-environment jsdom
 */
import {
  loadPluginApp,
  mountPluginContentScripts,
} from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  window.localStorage.clear();
});

describe("open-in-chrome content script", () => {
  it("sends ordinary http link clicks to plugin RPC and disables the in-app browser preference", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, result: { url: "https://example.com/" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const app = await loadPluginApp(() => import("./app.ts"));
    const scripts = await mountPluginContentScripts(app, {
      pluginId: "open-in-chrome",
    });

    expect(window.localStorage.getItem("bb.openLinksInAppBrowser")).toBe(
      "false",
    );

    const link = document.createElement("a");
    link.href = "https://example.com";
    link.textContent = "Example";
    document.body.append(link);
    link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }),
    );

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/plugins/open-in-chrome/rpc/openUrl",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ url: "https://example.com/" }),
        }),
      );
    });

    await scripts.lifecycle.dispose();
  });

  it("intercepts markdown-style _blank http links", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, result: { url: "https://example.com/" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const app = await loadPluginApp(() => import("./app.ts"));
    const scripts = await mountPluginContentScripts(app, {
      pluginId: "open-in-chrome",
    });

    const link = document.createElement("a");
    link.href = "https://example.com";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Example";
    document.body.append(link);
    const event = new MouseEvent("click", {
      bubbles: true,
      button: 0,
      cancelable: true,
    });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/plugins/open-in-chrome/rpc/openUrl",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ url: "https://example.com/" }),
        }),
      );
    });

    await scripts.lifecycle.dispose();
  });

  it("leaves same-origin and modified clicks alone", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const app = await loadPluginApp(() => import("./app.ts"));
    const scripts = await mountPluginContentScripts(app, {
      pluginId: "open-in-chrome",
    });

    const internal = document.createElement("a");
    internal.href = `${window.location.origin}/threads/thr_1`;
    document.body.append(internal);
    internal.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }),
    );

    const external = document.createElement("a");
    external.href = "https://example.com";
    document.body.append(external);
    external.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        button: 0,
        metaKey: true,
        cancelable: true,
      }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    await scripts.lifecycle.dispose();
  });

  it("routes desktop openExternalUrl http links through plugin RPC", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, result: { url: "https://example.com/" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const original = vi.fn();
    const desktop = { openExternalUrl: original };
    vi.stubGlobal("bbDesktop", desktop);

    const app = await loadPluginApp(() => import("./app.ts"));
    const scripts = await mountPluginContentScripts(app, {
      pluginId: "open-in-chrome",
    });

    desktop.openExternalUrl("https://example.com");
    desktop.openExternalUrl("mailto:aj@example.com");

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/plugins/open-in-chrome/rpc/openUrl",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ url: "https://example.com" }),
        }),
      );
    });
    expect(original).toHaveBeenCalledTimes(1);
    expect(original).toHaveBeenCalledWith("mailto:aj@example.com");

    await scripts.lifecycle.dispose();
    desktop.openExternalUrl("https://example.com/after-dispose");
    expect(original).toHaveBeenCalledWith("https://example.com/after-dispose");
  });
});
