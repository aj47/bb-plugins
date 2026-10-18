# bb-plugins

Plugins for [bb](https://getbb.app), the agentic IDE.

| Plugin | What it does |
| --- | --- |
| [fork-and-agents](fork-and-agents) | Fork a thread from any message, and see a thread's background tasks, subagents and child threads. |
| [media](media) | Show local images, videos and audio inline in chat with a `::media{file="..."}` directive. |
| [open-in-chrome](open-in-chrome) | Open HTTP(S) links clicked in bb in Google Chrome instead of the in-app browser. |

## Install

Each plugin is its own directory, indexed in `.bb/plugins.json`. Install one straight from this repository:

```sh
bb plugin install git:https://github.com/aj47/bb-plugins.git@main --plugin fork-and-agents
bb plugin install git:https://github.com/aj47/bb-plugins.git@main --plugin media
bb plugin install git:https://github.com/aj47/bb-plugins.git@main --plugin open-in-chrome
```

Or clone the repository and install a local copy, which picks up edits as you make them:

```sh
git clone https://github.com/aj47/bb-plugins.git
cd bb-plugins/open-in-chrome
npm install --include=dev
bb plugin build
bb plugin install .
```

Run `bb plugin dev` inside a plugin directory to rebuild and reload it on every save.
