# Project Brief: xAI Search MCP Server

## Goal
Create a lightweight MCP (Model Context Protocol) server that exposes xAI's built-in `web_search` and `x_search` tools to any MCP-compatible client (Claude Desktop, Cursor, VS Code, etc.).

## Core Requirements
- User provides only an xAI API key via environment variable
- Two MCP tools: `web_search` and `x_search`
- All results include extracted citations (source URLs)
- Default model: `grok-4-1-fast-reasoning` (configurable via `XAI_MODEL` env var)
- Transport: stdio (for local MCP client integration)

## Scope
- Single-file TypeScript MCP server
- No database, no caching, no state
- Uses xAI Responses API (`POST /v1/responses`) with server-side built-in tools
