# Technical Context

## Technologies
- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js 18+ (native `fetch`)
- **MCP SDK**: `@modelcontextprotocol/sdk` v1.12+
- **Validation**: `zod` v3
- **Transport**: stdio (`StdioServerTransport`)

## Build
- TypeScript compiler (`tsc`) targeting ES2022, Node16 modules
- Output: `build/index.js` with executable permission
- Command: `npm run build`

## Dependencies
- `@modelcontextprotocol/sdk` — MCP server framework
- `zod` — Schema validation for tool inputs
- Dev: `typescript`, `@types/node`

## Environment Variables
| Variable | Required | Default | Description |
|---|---|---|---|
| `XAI_API_KEY` | Yes | — | xAI API authentication key |
| `XAI_MODEL` | No | `grok-4-1-fast-reasoning` | Model for Responses API |

## Project Structure
```
src/index.ts    → Server entry point (types, helpers, MCP tools)
build/index.js  → Compiled output
package.json    → Dependencies and scripts
tsconfig.json   → TypeScript configuration
README.md       → Setup and usage documentation
```
