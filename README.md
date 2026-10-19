# xAI Search MCP Server

An MCP (Model Context Protocol) server that provides real-time web search and X (Twitter) search capabilities via the [xAI API](https://docs.x.ai/).

## Quick Start

Requires Node.js 22 or newer. The easiest way to use this server is via `npx` — no clone or build required:

```bash
XAI_API_KEY=your_key npx @kicito/xai-search-mcp
```

On Windows PowerShell:

```powershell
$env:XAI_API_KEY = "your_key"
npx @kicito/xai-search-mcp
```

Just set your `XAI_API_KEY` environment variable and configure your MCP client (see [Configuration](#configuration) below).

## Tools

### `web_search`
Search the web in real-time. Returns results with source citations.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | ✅ | The search query; trimmed and must not be empty |
| `allowed_domains` | string[] | ❌ | Only search within these domains (max 5) |
| `excluded_domains` | string[] | ❌ | Exclude these domains from search (max 5) |

### `x_search`
Search X (Twitter) posts, users, and threads. Returns results with source citations.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | ✅ | The search query for X posts; trimmed and must not be empty |
| `allowed_x_handles` | string[] | ❌ | Only consider posts from these handles (max 10) |
| `excluded_x_handles` | string[] | ❌ | Exclude posts from these handles (max 10) |
| `from_date` | string | ❌ | Inclusive start date (valid calendar date in `YYYY-MM-DD`, e.g. `2025-01-01`) |
| `to_date` | string | ❌ | Exclusive end date (valid calendar date in `YYYY-MM-DD`, e.g. `2025-06-01`) |

### Input validation

- Queries are trimmed; empty or whitespace-only queries are rejected.
- Domains are trimmed, lowercased and IDNA-normalized, with a trailing root dot removed. Supply bare domains (for example, `example.com`) rather than URLs. Empty or invalid entries are rejected.
- X handles are trimmed and a leading `@` is removed. Handles must contain 1–15 letters, digits or underscores; case is preserved. Profile URLs are not accepted.
- For each tool, nonempty allow and exclude lists cannot be combined. Empty filter arrays (and `null` or omitted filters) are treated as absent.
- Dates must be real calendar dates in exactly `YYYY-MM-DD` format, not timestamps. When both dates are provided, `from_date` must be on or before `to_date`.

X handle/date filters apply to search, not thread fetches. Handle lists are conservatively capped at 10 entries.

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 22 or newer
- An [xAI API key](https://console.x.ai/)

### Install & Build

```bash
npm ci
npm run build
```

Run these commands from a cloned checkout. The build uses TypeScript and a Node.js helper, with no POSIX `chmod` command required; it works on Linux, macOS, and Windows.

### Configuration

#### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "xai-search": {
      "command": "npx",
      "args": ["-y", "@kicito/xai-search-mcp"],
      "env": {
        "XAI_API_KEY": "your-xai-api-key-here"
      }
    }
  }
}
```

#### Cursor

Add to your Cursor MCP settings:

```json
{
  "mcpServers": {
    "xai-search": {
      "command": "npx",
      "args": ["-y", "@kicito/xai-search-mcp"],
      "env": {
        "XAI_API_KEY": "your-xai-api-key-here"
      }
    }
  }
}
```

<details>
<summary>Alternative: Local build</summary>

If you prefer to clone and build manually:

```bash
git clone https://github.com/kicito/x_search_mcp.git
cd x_search_mcp
npm ci
npm run build
```

Then use the full path in your config:

```json
{
  "mcpServers": {
    "xai-search": {
      "command": "node",
      "args": ["/absolute/path/to/x_search_mcp/build/index.js"],
      "env": {
        "XAI_API_KEY": "your-xai-api-key-here"
      }
    }
  }
}
```

</details>

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `XAI_API_KEY` | ✅ | — | Your xAI API key |
| `XAI_MODEL` | ❌ | `grok-4-1-fast-reasoning` | The xAI model to use |
| `XAI_TIMEOUT_MS` | ❌ | `120000` | Application request timeout in milliseconds; positive integer, maximum `2147483647` |

Requests are bounded by the application timeout, including response-body processing. MCP request cancellation aborts the upstream request and stops processing without a response. Timeouts and upstream failures return tool errors; upstream error details are sanitized and bounded rather than returning arbitrary raw response bodies. Requests are not automatically retried.

## How It Works

The server uses the [xAI Responses API](https://docs.x.ai/developers/tools/overview) with built-in server-side tools (`web_search` and `x_search`). When an MCP client calls one of the tools, the server:

1. Sends the query to `POST https://api.x.ai/v1/responses` with the appropriate tool configuration
2. Grok executes the search, gathers results, and generates a response
3. Citations (source URLs) are extracted from the response annotations
4. The response text and formatted citations are returned to the MCP client

## Development

```bash
# Install the locked dependencies
npm ci

# Type-check without emitting build output
npm run typecheck

# Build
npm run build

# Build and run offline tests
npm test

# Build and verify npm package contents and executable metadata (offline dry-run)
npm run test:package

# Start after setting XAI_API_KEY in your shell or MCP client
npm start
```

`npm run check:package` checks an existing build without rebuilding. Package checks verify the CLI entrypoint, executable metadata, build files, README, manifest, and MIT license using `npm pack --dry-run --json`; they do not publish or require an API key. Tests use mocked requests, not live xAI searches.

CI runs type-checking, tests, and package checks on Node.js 22 and 24 on Linux, plus Node.js 22 on Windows. Tag-triggered npm publishing is gated on the same checks and uses Node.js 22.

## License

MIT — see [LICENSE](LICENSE).
