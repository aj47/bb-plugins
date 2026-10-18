# Grok usage

Feeds Grok Build's weekly SuperGrok quota into BB **Settings → Usage limits**.

```sh
bb plugin install git:https://github.com/aj47/bb-plugins.git@main --plugin grok-usage
bb grok-usage show
```

Does not require the Grok CLI. Uses SuperGrok OAuth from Pi (`~/.pi/agent/auth.json`) or `grok login` if present.
