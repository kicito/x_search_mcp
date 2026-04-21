# Product Context

## Problem
Users of MCP-compatible AI assistants (Claude Desktop, Cursor, etc.) need real-time web and X/Twitter search capabilities. xAI provides powerful built-in search tools via their Responses API, but there's no MCP server wrapper available.

## Solution
This MCP server acts as a bridge between MCP clients and the xAI Responses API. It translates MCP tool calls into xAI API requests and returns formatted results with citations.

## User Experience
1. User configures the MCP server in their client with just an API key
2. The AI assistant can call `web_search` or `x_search` tools
3. Results come back with inline text and appended source citations
4. No additional setup or authentication beyond the xAI API key
