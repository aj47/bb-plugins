const HTTP_URL_PATTERN = /^https?:\/\//iu;

export function isHttpOrHttpsUrl(url: string): boolean {
  return HTTP_URL_PATTERN.test(url);
}

export function parseHttpUrl(url: string): URL {
  const trimmed = url.trim();
  if (!isHttpOrHttpsUrl(trimmed)) {
    throw new Error("url must be an http or https address");
  }
  try {
    return new URL(trimmed);
  } catch {
    throw new Error("url is not a valid address");
  }
}

export function shouldInterceptAnchorClick(event: MouseEvent): boolean {
  if (event.defaultPrevented) return false;
  if (event.button !== 0) return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return false;
  }
  return true;
}

export function findClickedAnchor(
  target: EventTarget | null,
): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null;
  const anchor = target.closest("a");
  return anchor instanceof HTMLAnchorElement ? anchor : null;
}

export function hrefFromAnchor(anchor: HTMLAnchorElement): string | null {
  const raw = anchor.getAttribute("href");
  if (raw === null || raw.trim() === "") return null;
  if (raw.startsWith("#")) return null;
  if (raw.startsWith("mailto:") || raw.startsWith("javascript:")) return null;
  try {
    const resolved = new URL(raw, window.location.href);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return null;
    }
    if (resolved.origin === window.location.origin) return null;
    return resolved.href;
  } catch {
    return null;
  }
}
