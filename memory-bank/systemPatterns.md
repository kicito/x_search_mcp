# System Patterns

## Architecture
```
MCP Client → stdio → MCP Server → HTTP POST → xAI Responses API → Results
```

## API Integration Pattern
- Endpoint: `POST https://api.x.ai/v1/responses`
- Auth: `Authorization: Bearer $XAI_API_KEY`
- Body: `{ model, input: [{role, content}], tools: [{type, ...filters}] }`
- Response parsing: Extract `output[].content[].text` and `output[].content[].annotations[].url`

## Tool Parameter Mapping

### web_search
- MCP params → xAI tool config `{ type: "web_search", filters: { allowed_domains, excluded_domains } }`

### x_search
- MCP params → xAI tool config `{ type: "x_search", allowed_x_handles, excluded_x_handles, from_date, to_date }`

## Error Handling
- Missing API key: immediate exit with error message
- API errors: returned as `isError: true` MCP responses
- Mutual exclusion validation (allowed vs excluded params) before API call

## Logging
- All logging to stderr only (stdio transport requirement)
- `console.error()` used exclusively
