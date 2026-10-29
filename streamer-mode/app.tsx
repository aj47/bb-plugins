// bb-plugin-streamer-mode — masks email addresses in the bb app shell.
//
// A content script watches the DOM and rewrites any email in visible text or
// in title/aria-label attributes, e.g. "email@example.com" -> "em•••@ex•••.com".
// Editable regions are skipped so typing is never altered. Disabling the
// plugin restores every original value.
import { definePluginApp } from "@get-bb/plugin-sdk/app";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const ATTRIBUTES = ["title", "aria-label", "placeholder", "alt"];
const SKIP = "input, textarea, [contenteditable=''], [contenteditable='true'], script, style";

function maskPart(part: string): string {
  return `${part.slice(0, 2)}•••`;
}

export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  const dot = domain.lastIndexOf(".");
  return `${maskPart(name)}@${maskPart(domain.slice(0, dot))}${domain.slice(dot)}`;
}

function maskText(text: string): string {
  return text.replace(EMAIL, maskEmail);
}

function mountMasking(): () => void {
  const originalText = new Map<Text, string>();
  const originalAttrs = new Map<Element, Map<string, string>>();

  const skipped = (element: Element | null) => element?.closest(SKIP) != null;

  const maskTextNode = (node: Text) => {
    if (skipped(node.parentElement)) return;
    const value = node.nodeValue ?? "";
    if (!value.includes("@")) return;
    const masked = maskText(value);
    if (masked === value) return;
    originalText.set(node, value);
    node.nodeValue = masked;
  };

  const maskAttrs = (element: Element) => {
    if (skipped(element)) return;
    for (const name of ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value === null || !value.includes("@")) continue;
      const masked = maskText(value);
      if (masked === value) continue;
      let saved = originalAttrs.get(element);
      if (saved === undefined) originalAttrs.set(element, (saved = new Map()));
      saved.set(name, value);
      element.setAttribute(name, masked);
    }
  };

  const scan = (root: Node) => {
    if (root instanceof Text) return maskTextNode(root);
    if (!(root instanceof Element)) return;
    maskAttrs(root);
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    );
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node instanceof Text) maskTextNode(node);
      else maskAttrs(node as Element);
    }
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") scan(record.target);
      else if (record.type === "attributes") maskAttrs(record.target as Element);
      else record.addedNodes.forEach(scan);
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRIBUTES,
  });
  scan(document.body);

  return () => {
    observer.disconnect();
    for (const [node, value] of originalText) {
      if (node.isConnected && node.nodeValue === maskText(value)) node.nodeValue = value;
    }
    for (const [element, saved] of originalAttrs) {
      if (!element.isConnected) continue;
      for (const [name, value] of saved) {
        if (element.getAttribute(name) === maskText(value)) element.setAttribute(name, value);
      }
    }
    originalText.clear();
    originalAttrs.clear();
  };
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "mask-emails",
    mount: () => mountMasking(),
  });
});
