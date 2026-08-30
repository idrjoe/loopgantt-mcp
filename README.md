# @loopgantt/mcp-server

MCP (Model Context Protocol) server for [LoopGantt](https://loopgantt.com). Turn a plain-language plan into a real Gantt chart from Claude Desktop, Cursor, or any MCP client — **no account, no API key**.

## Remote server (no install)

Point your MCP client at **`https://loopgantt.com/api/mcp`** (Streamable HTTP). Nothing to install, no account, no key.

- **Claude** (claude.ai / Claude Desktop): Settings → Connectors → _Add custom connector_ → URL `https://loopgantt.com/api/mcp`.
- **ChatGPT**: Settings → Connectors → _Create_ → MCP server URL `https://loopgantt.com/api/mcp`, authentication _None_.
- **Cursor and other clients** (`mcp.json`):

```json
{
  "mcpServers": {
    "loopgantt": {
      "url": "https://loopgantt.com/api/mcp"
    }
  }
}
```

The remote server exposes the keyless tools, resources and prompt below. The account tools (`create_project`, `list_projects`) need an API key and are only available on the local server for now.

## Local server (npm)

```bash
npm install -g @loopgantt/mcp-server
```

Add to your MCP client config (Claude Desktop: `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "loopgantt": {
      "command": "loopgantt-mcp"
    }
  }
}
```

Restart the client and ask:

- "Make a Gantt chart for a 6-week website relaunch"
- "Plan a kitchen renovation with realistic durations and dependencies"
- "Schedule the launch of our mobile app starting September 1"

Your assistant drafts the tasks, durations and dependencies; LoopGantt schedules them with its critical-path engine and replies with a **picture of the chart**, the dates, the critical path and a **link** where you can view the chart, export it (PNG / PDF) and save it to a free account.

Unclaimed charts expire after 7 days (30 days once the link is opened). Saving to an account keeps them forever.

## Tools

### `create_gantt` — no key needed

| Parameter          | Description                                                                                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name` (required)  | Project name                                                                                                                                                                                                                  |
| `description`      | Optional one-liner                                                                                                                                                                                                            |
| `startDate`        | `YYYY-MM-DD`, defaults to today                                                                                                                                                                                               |
| `workDays`         | Working weekdays as ISO numbers `1` (Mon) … `7` (Sun); default Mon–Fri                                                                                                                                                        |
| `holidays`         | Non-working dates, `YYYY-MM-DD`                                                                                                                                                                                               |
| `tasks` (required) | In execution order: `{ name, duration, isMilestone?, description?, dependencies? }` — `duration` in working days (`0` = milestone); `dependencies` are indices of **earlier** tasks, or `{ task, type: FS\|SS\|FF\|SF, lag }` |

Limits: 300 tasks, 20 dependencies per task, 10 charts per hour and 30 per day per network (the hosted server at `loopgantt.com/api/mcp` allows 60 per hour and 300 per day per network, because hosted assistants share a few addresses). Dates in replies are the first and last working day of each task.

### `schedule_project` — no key needed

Same input as `create_gantt` (`name` optional). Returns dates, critical path, float and the project end **without storing anything** — for "what's my critical path?" / "when would this finish?" questions. Limit: 60 calls per hour per network.

### `list_templates` / `get_template` — no key needed

The industry templates (software, construction, marketing, events, IT, HR, finance) with their task lists, ready to adapt and pass to `create_gantt`. Also exposed as MCP **resources** (`loopgantt://templates/<slug>`).

### Prompt: `plan_project`

A guided flow — arguments `goal`, `deadline?`, `team_size?` — that drafts a work breakdown, creates the chart and presents the picture, the critical path and the link.

### With an API key — account tools

Get a key at <https://loopgantt.com/settings/api-keys> and pass it as an environment variable:

```json
{
  "mcpServers": {
    "loopgantt": {
      "command": "loopgantt-mcp",
      "env": { "LOOPGANTT_API_KEY": "sk_live_…" }
    }
  }
}
```

This enables `create_project` (creates the project directly in your account) and `list_projects`.

## Environment variables

| Variable            | Description                                           | Required |
| ------------------- | ----------------------------------------------------- | -------- |
| `LOOPGANTT_API_KEY` | Enables the account tools                             | No       |
| `LOOPGANTT_API_URL` | API base URL (default `https://loopgantt.com/api/v1`) | No       |

## API

The server is a thin client over LoopGantt's public API — see the OpenAPI spec at <https://loopgantt.com/openapi.json>.

## License

MIT
