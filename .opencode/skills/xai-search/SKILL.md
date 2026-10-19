---
name: xai-search
description: Search current web information and X posts with the xAI MCP tools, using source citations and focused filters.
---

# xAI search

Use this skill when a user needs current facts, source-backed answers, or posts from X. It guides use of the separately configured `xai-search` MCP server; it does not install or run a search tool itself.

- Use `web_search` for current web facts; use `x_search` for X posts, users, or threads. Send a specific, nonempty `query` and refine it if the results are too broad.
- Narrow web searches with `allowed_domains` **or** `excluded_domains` (up to 5 bare domains per list, not URLs). Narrow X searches with `allowed_x_handles` **or** `excluded_x_handles` (up to 10 handles per list; use handles, not profile URLs). Do not combine allow and exclude lists for the same tool.
- For X time ranges, use calendar dates in `YYYY-MM-DD`: `from_date` is inclusive and `to_date` is exclusive. For example, to search only October 1, set `from_date` to `2026-10-01` and `to_date` to `2026-10-02`.
- Cite the actual source URLs returned by the tool when making sourced claims. Never fabricate links, quotes, or search results; if results or citations are missing, say so and qualify the answer.
- If the MCP tools are unavailable, tell the user the server must be configured separately; do not claim you searched. Setup instructions are in the repository README.
