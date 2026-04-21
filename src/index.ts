#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const XAI_API_KEY = process.env.XAI_API_KEY;
const XAI_MODEL = process.env.XAI_MODEL ?? "grok-4-1-fast-reasoning";
const XAI_API_BASE = "https://api.x.ai/v1";

if (!XAI_API_KEY) {
  console.error("ERROR: XAI_API_KEY environment variable is required.");
  console.error("Set it via your MCP client config or export it before running.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CitationAnnotation {
  type: string;
  url: string;
  title: string;
  start_index: number;
  end_index: number;
}

interface OutputContent {
  type: string;
  text?: string;
  annotations?: CitationAnnotation[];
}

interface OutputItem {
  type: string;
  content?: OutputContent[];
}

interface XaiResponse {
  id: string;
  output?: OutputItem[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractResult(data: XaiResponse): { text: string; citations: string[] } {
  let text = "";
  const citationSet = new Set<string>();

  if (data.output && Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === "message" && item.content) {
        for (const content of item.content) {
          if (content.type === "output_text" && content.text) {
            text += content.text;
          }
          if (content.annotations && Array.isArray(content.annotations)) {
            for (const annotation of content.annotations) {
              if (annotation.url) {
                citationSet.add(annotation.url);
              }
            }
          }
        }
      }
    }
  }

  return { text, citations: Array.from(citationSet) };
}

function formatResponseWithCitations(text: string, citations: string[]): string {
  if (citations.length === 0) {
    return text;
  }
  const citationLines = citations
    .map((url, index) => `[${index + 1}] ${url}`)
    .join("\n");
  return `${text}\n\n---\nSources:\n${citationLines}`;
}

async function callXaiApi(
  query: string,
  tools: Record<string, unknown>[],
): Promise<{ text: string; citations: string[] }> {
  const response = await fetch(`${XAI_API_BASE}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: XAI_MODEL,
      input: [{ role: "user", content: query }],
      tools,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`xAI API error (${response.status}): ${errorBody}`);
  }

  const data: XaiResponse = await response.json();
  return extractResult(data);
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "xai-search",
  version: "1.0.0",
});

// --- Tool: web_search ---

server.tool(
  "web_search",
  "Search the web in real-time using xAI. Returns results with source citations.",
  {
    query: z.string().describe("The search query"),
    allowed_domains: z
      .array(z.string())
      .max(5)
      .nullable()
      .optional()
      .describe("Only search within these domains (max 5). Cannot be used with excluded_domains."),
    excluded_domains: z
      .array(z.string())
      .max(5)
      .nullable()
      .optional()
      .describe("Exclude these domains from search (max 5). Cannot be used with allowed_domains."),
  },
  async (params) => {
    try {
      const webSearchTool: Record<string, unknown> = { type: "web_search" };

      if (params.allowed_domains && params.excluded_domains) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: allowed_domains and excluded_domains cannot be used together.",
            },
          ],
          isError: true,
        };
      }

      if (params.allowed_domains && params.allowed_domains.length > 0) {
        webSearchTool.filters = { allowed_domains: params.allowed_domains };
      }
      if (params.excluded_domains && params.excluded_domains.length > 0) {
        webSearchTool.filters = { excluded_domains: params.excluded_domains };
      }

      const { text, citations } = await callXaiApi(params.query, [webSearchTool]);
      const result = formatResponseWithCitations(text, citations);

      return {
        content: [{ type: "text" as const, text: result }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `Web search failed: ${message}` }],
        isError: true,
      };
    }
  },
);

// --- Tool: x_search ---

server.tool(
  "x_search",
  "Search X (Twitter) posts, users, and threads in real-time using xAI. Returns results with source citations.",
  {
    query: z.string().describe("The search query for X posts"),
    allowed_x_handles: z
      .array(z.string())
      .max(10)
      .nullable()
      .optional()
      .describe("Only consider posts from these X handles (max 10). Cannot be used with excluded_x_handles."),
    excluded_x_handles: z
      .array(z.string())
      .max(10)
      .nullable()
      .optional()
      .describe("Exclude posts from these X handles (max 10). Cannot be used with allowed_x_handles."),
    from_date: z
      .string()
      .nullable()
      .optional()
      .describe("Start date for search range in ISO8601 format (e.g. YYYY-MM-DD)."),
    to_date: z
      .string()
      .nullable()
      .optional()
      .describe("End date for search range in ISO8601 format (e.g. YYYY-MM-DD)."),
  },
  async (params) => {
    try {
      const xSearchTool: Record<string, unknown> = { type: "x_search" };

      if (params.allowed_x_handles && params.excluded_x_handles) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: allowed_x_handles and excluded_x_handles cannot be used together.",
            },
          ],
          isError: true,
        };
      }

      if (params.allowed_x_handles && params.allowed_x_handles.length > 0) {
        xSearchTool.allowed_x_handles = params.allowed_x_handles;
      }
      if (params.excluded_x_handles && params.excluded_x_handles.length > 0) {
        xSearchTool.excluded_x_handles = params.excluded_x_handles;
      }
      if (params.from_date) {
        xSearchTool.from_date = params.from_date;
      }
      if (params.to_date) {
        xSearchTool.to_date = params.to_date;
      }

      const { text, citations } = await callXaiApi(params.query, [xSearchTool]);
      const result = formatResponseWithCitations(text, citations);

      return {
        content: [{ type: "text" as const, text: result }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `X search failed: ${message}` }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`xAI Search MCP Server running on stdio (model: ${XAI_MODEL})`);
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
