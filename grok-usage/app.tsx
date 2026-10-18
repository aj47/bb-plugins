import { definePluginApp } from "@get-bb/plugin-sdk/app";

function GrokIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0.36 0.5 33.33 32"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M13.2371 21.0407L24.3186 12.8506C24.8619 12.4491 25.6384 12.6057 25.8973 13.2294C27.2597 16.5185 26.651 20.4712 23.9403 23.1851C21.2297 25.8989 17.4581 26.4941 14.0108 25.1386L10.2449 26.8843C15.6463 30.5806 22.2053 29.6665 26.304 25.5601C29.5551 22.3051 30.562 17.8683 29.6205 13.8673L29.629 13.8758C28.2637 7.99809 29.9647 5.64871 33.449 0.844576C33.5314 0.730667 33.6139 0.616757 33.6964 0.5L29.1113 5.09055V5.07631L13.2343 21.0436" />
      <path d="M10.9503 23.0313C7.07343 19.3235 7.74185 13.5853 11.0498 10.2763C13.4959 7.82722 17.5036 6.82767 21.0021 8.2971L24.7595 6.55998C24.0826 6.07017 23.215 5.54334 22.2195 5.17313C17.7198 3.31926 12.3326 4.24192 8.67479 7.90126C5.15635 11.4239 4.0499 16.8403 5.94992 21.4622C7.36924 24.9165 5.04257 27.3598 2.69884 29.826C1.86829 30.7002 1.0349 31.5745 0.36364 32.5L10.9474 23.0341" />
    </svg>
  );
}

function usageLimitsRoot(): HTMLElement | null {
  const heading = Array.from(document.querySelectorAll("h2")).find(
    (node) => node.textContent?.trim() === "Usage limits",
  );
  if (!heading) return null;
  return (heading.closest("section") ?? heading.parentElement) as HTMLElement | null;
}

function rewriteCopy(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text && node.nodeValue?.includes("acp-grok")) nodes.push(node);
  }
  for (const node of nodes) {
    node.nodeValue = (node.nodeValue ?? "")
      .replaceAll(
        "Sign in to acp-grok, then reload usage.",
        "Sign in with Pi `/login xai` or `grok login`, then reload usage.",
      )
      .replaceAll(
        "Your acp-grok session expired. Sign in again, then reload usage.",
        "Your SuperGrok session expired. Sign in again with Pi `/login xai` or `grok login`, then reload usage.",
      )
      .replaceAll("acp-grok", "Grok Build");
  }
}

function providerList(root: HTMLElement): HTMLElement | null {
  const list = root.querySelector("div.divide-y");
  return list instanceof HTMLElement ? list : null;
}

function rowForTitle(list: HTMLElement, match: (title: string) => boolean): HTMLElement | null {
  const titles = Array.from(list.querySelectorAll("h3"));
  const title = titles.find((node) => match(node.textContent?.trim() ?? ""));
  if (!title) return null;
  let current: HTMLElement | null = title;
  while (current && current.parentElement !== list) current = current.parentElement;
  return current;
}

function moveGrokAboveOpencode(root: HTMLElement) {
  const list = providerList(root);
  if (!list) return;
  const grok = rowForTitle(
    list,
    (title) => title === "acp-grok" || title === "Grok Build" || title === "Grok",
  );
  const opencode = rowForTitle(list, (title) => title.toLowerCase() === "opencode");
  if (!grok || !opencode || grok === opencode) return;
  if (grok.compareDocumentPosition(opencode) & Node.DOCUMENT_POSITION_FOLLOWING) return;
  list.insertBefore(grok, opencode);
}

function decorateUsageLimits() {
  const root = usageLimitsRoot();
  if (!root) return;
  rewriteCopy(root);
  moveGrokAboveOpencode(root);
}

export default definePluginApp((app) => {
  app.slots.experimental_providerIcon({
    providerKind: "agent",
    providerId: "acp-grok",
    icon: GrokIcon,
  });

  app.contentScripts.register({
    id: "usage-limits-grok",
    mount({ signal }) {
      const observer = new MutationObserver(decorateUsageLimits);
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      decorateUsageLimits();
      const stop = () => observer.disconnect();
      signal.addEventListener("abort", stop, { once: true });
      return stop;
    },
  });
});
