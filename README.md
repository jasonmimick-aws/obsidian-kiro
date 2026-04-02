# Kiro for Obsidian

Use [Kiro CLI](https://kiro.dev) as an AI agent inside [Obsidian](https://obsidian.md) via the [Agent Client Protocol (ACP)](https://agentclientprotocol.com/).

Query Dynatrace, manage AWS, create dashboards — all from your notes.

## Install

1. Clone this repo into your vault's `.obsidian/plugins/` directory
2. Run `npm install && npm run build`
3. Enable "Kiro" in Settings → Community Plugins

## Requirements

- [Kiro CLI](https://kiro.dev/downloads/) installed and on your PATH
- Obsidian 1.5.0+

## Usage

Click the robot icon in the left ribbon, or run "Open Kiro chat" from the command palette (Cmd+P).

## How it works

The plugin spawns `kiro-cli acp --trust-all-tools` as a subprocess and communicates over JSON-RPC (ACP protocol). Kiro picks up MCP servers and skills from `~/.kiro/settings/` — configure Dynatrace, AWS, or any MCP server once and it works here automatically.

## License

Apache-2.0
