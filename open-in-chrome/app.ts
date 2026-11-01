import { definePluginApp } from "@get-bb/plugin-sdk/app";
import {
  findClickedAnchor,
  hrefFromAnchor,
  shouldInterceptAnchorClick,
} from "./url.js";

const OPEN_LINKS_IN_APP_BROWSER_STORAGE_KEY = "bb.openLinksInAppBrowser";

function disableInAppBrowserPreference(): void {
  const value = JSON.stringify(false);
  try {
    if (window.localStorage.getItem(OPEN_LINKS_IN_APP_BROWSER_STORAGE_KEY) === value) {
      return;
    }
    window.localStorage.setItem(OPEN_LINKS_IN_APP_BROWSER_STORAGE_KEY, value);
    // atomWithStorage only observes the `storage` event, which setItem does not
    // fire in the same window. Dispatch it so a live bb session picks this up.
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: OPEN_LINKS_IN_APP_BROWSER_STORAGE_KEY,
        newValue: value,
        storageArea: window.localStorage,
      }),
    );
  } catch {
    // The preference is client-local; failing to write it still leaves click
    // interception in place for ordinary anchors.
  }
}

interface BbDesktopBridge {
  openExternalUrl?: (url: string) => unknown;
  [key: string]: unknown;
}

function isHttpUrlString(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function desktopBridge(): BbDesktopBridge | undefined {
  return (window as Window & { bbDesktop?: BbDesktopBridge }).bbDesktop;
}

function installDesktopExternalUrlHook(
  pluginId: string,
  signal: AbortSignal,
): void {
  const desktop = desktopBridge();
  if (desktop === undefined || typeof desktop.openExternalUrl !== "function") {
    return;
  }
  const originalFn = desktop.openExternalUrl;
  const original = originalFn.bind(desktop);
  const wrapped = (url: string) => {
    if (!isHttpUrlString(url)) {
      return original(url);
    }
    void openUrl(pluginId, url).catch((error) => {
      console.warn(
        `[plugin:${pluginId}] failed to open ${url} in Chrome: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      original(url);
    });
  };
  desktop.openExternalUrl = wrapped;
  const restore = () => {
    if (desktop.openExternalUrl === wrapped) {
      desktop.openExternalUrl = originalFn;
    }
  };
  signal.addEventListener("abort", restore, { once: true });
}

async function openUrl(pluginId: string, url: string): Promise<void> {
  const response = await fetch(`/api/v1/plugins/${pluginId}/rpc/openUrl`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const body = (await response.json().catch(() => null)) as
    | { ok: true; result: { url: string } }
    | { ok: false; error?: { message?: string } }
    | null;
  if (!response.ok || body === null || body.ok !== true) {
    const message =
      body && body.ok === false
        ? (body.error?.message ?? `HTTP ${response.status}`)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "open-http-links-in-chrome",
    mount({ pluginId, signal }) {
      // Chrome launches on the host machine, so only take over links in the
      // desktop app. Mobile and remote web clients keep their own browser.
      if (desktopBridge() === undefined) return;

      disableInAppBrowserPreference();
      installDesktopExternalUrlHook(pluginId, signal);

      const onClick = (event: MouseEvent) => {
        if (!shouldInterceptAnchorClick(event)) return;
        const anchor = findClickedAnchor(event.target);
        if (anchor === null) return;
        if (anchor.hasAttribute("download")) return;
        const url = hrefFromAnchor(anchor);
        if (url === null) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void openUrl(pluginId, url).catch((error) => {
          console.warn(
            `[plugin:${pluginId}] failed to open ${url} in Chrome: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      };

      document.addEventListener("click", onClick, true);
      signal.addEventListener(
        "abort",
        () => document.removeEventListener("click", onClick, true),
        { once: true },
      );
      return () => document.removeEventListener("click", onClick, true);
    },
  });
});
