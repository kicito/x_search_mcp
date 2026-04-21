# xAI Search MCP Server

An MCP (Model Context Protocol) server that provides real-time web search and X (Twitter) search capabilities via the [xAI API](https://docs.x.ai/).

## Tools

### `web_search`
Search the web in real-time. Returns results with source citations.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | ✅ | The search query |
| `allowed_domains` | string[] | ❌ | Only search within these domains (max 5) |
| `excluded_domains` | string[] | ❌ | Exclude these domains from search (max 5) |

### `x_search`
Search X (Twitter) posts, users, and threads. Returns results with source citations.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | ✅ | The search query for X posts |
| `allowed_x_handles` | string[] | ❌ | Only consider posts from these handles (max 10) |
| `excluded_x_handles` | string[] | ❌ | Exclude posts from these handles (max 10) |
| `from_date` | string | ❌ | Start date (ISO8601, e.g. `2025-01-01`) |
| `to_date` | string | ❌ | End date (ISO8601, e.g. `2025-06-01`) |

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ (for native `fetch` support)
- An [xAI API key](https://console.x.ai/)

### Install & Build

```bash
npm install
npm run build
```

### Configuration

#### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

#### Cursor

Add to your Cursor MCP settings:

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

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `XAI_API_KEY` | ✅ | — | Your xAI API key |
| `XAI_MODEL` | ❌ | `grok-4-1-fast-reasoning` | The xAI model to use |

## How It Works

The server uses the [xAI Responses API](https://docs.x.ai/developers/tools/overview) with built-in server-side tools (`web_search` and `x_search`). When an MCP client calls one of the tools, the server:

1. Sends the query to `POST https://api.x.ai/v1/responses` with the appropriate tool configuration
2. Grok executes the search, gathers results, and generates a response
3. Citations (source URLs) are extracted from the response annotations
4. The response text and formatted citations are returned to the MCP client

## Development

```bash
# Build
npm run build

# Start (requires XAI_API_KEY env var)
XAI_API_KEY=your-key npm start
```

## License

MIT
