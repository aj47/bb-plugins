---
name: grok-usage
description: Show Grok Build subscription quota in BB's Usage limits section, or inspect it with bb grok-usage show.
---

# Grok Build usage

This plugin feeds Grok Build's weekly SuperGrok quota into **Settings → Usage limits** (the same quota section as Codex and Claude).

```sh
bb grok-usage show
bb grok-usage show --host <id-or-name>
bb grok-usage show --refresh --json
```

- Grok CLI is optional. The plugin reads SuperGrok OAuth from, in order: `~/.grok/auth.json`, Pi `~/.pi/agent/auth.json` (`xai`), then `GROK_OAUTH_TOKEN` / `XAI_OAUTH_TOKEN`.
- Expired Pi tokens are refreshed against `auth.x.ai` and written back to Pi's auth file. Grok CLI tokens are used as-is; run `grok` if those expire.
- The reading uses Grok Build's billing endpoint. Tokens are not copied into this plugin's storage.
- Product-share rows (Chat, Imagine, …) are omitted. The bar is the shared weekly SuperGrok pool.
- Sign in without Grok CLI: in Pi, `/login xai` (Use a subscription).
