import { readFileSync } from "node:fs";
import { domainToASCII } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const DEFAULT_MODEL = "grok-4-1-fast-reasoning";
const DEFAULT_TIMEOUT_MS = 120000;
const MAX_TIMEOUT_MS = 2147483647;
const manifest: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export interface ServerOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

type Config = Required<ServerOptions>;
type SearchResult = { text: string; citations: string[] };

export class ConfigurationError extends Error {}
// Only these locally generated messages may cross the tool boundary.
class SafeError extends Error {}
class RequestCancelled extends Error {
  constructor() { super("Request cancelled."); }
}

function validTimeout(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= MAX_TIMEOUT_MS;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerOptions {
  if (!env.XAI_API_KEY?.trim()) {
    throw new ConfigurationError("XAI_API_KEY environment variable is required.");
  }
  const rawTimeout = env.XAI_TIMEOUT_MS;
  const timeoutMs = rawTimeout === undefined ? DEFAULT_TIMEOUT_MS : Number(rawTimeout);
  if ((rawTimeout !== undefined && !/^\d+$/.test(rawTimeout.trim())) || !validTimeout(timeoutMs)) {
    throw new ConfigurationError("XAI_TIMEOUT_MS must be a positive integer no greater than 2147483647.");
  }
  return { apiKey: env.XAI_API_KEY, model: env.XAI_MODEL ?? DEFAULT_MODEL, timeoutMs };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformed(): never {
  throw new SafeError("xAI returned a malformed response.");
}

function extractResult(data: unknown): SearchResult {
  if (!isRecord(data)) malformed();
  if (data.error !== undefined && data.error !== null) {
    throw new SafeError("xAI reported an error while processing the request.");
  }
  if (data.status === "incomplete") {
    throw new SafeError("xAI returned an incomplete response. Try a narrower query.");
  }
  if (data.status !== "completed") {
    throw new SafeError("xAI response was not completed.");
  }
  if (!Array.isArray(data.output)) malformed();
  let text = "";
  const citations = new Set<string>();
  for (const item of data.output) {
    if (!isRecord(item) || typeof item.type !== "string") malformed();
    // Reasoning and tool output are not answers.
    if (item.type !== "message") continue;
    if (typeof item.role !== "string" || !Array.isArray(item.content)) malformed();
    if (item.role !== "assistant") continue;
    for (const content of item.content) {
      if (!isRecord(content) || typeof content.type !== "string") malformed();
      if (content.type === "refusal") {
        throw new SafeError("xAI refused to answer this request.");
      }
      if (content.type !== "output_text") continue;
      if (typeof content.text !== "string") malformed();
      text += content.text;
      if (content.annotations === undefined) continue;
      if (!Array.isArray(content.annotations)) malformed();
      for (const annotation of content.annotations) {
        if (!isRecord(annotation) || typeof annotation.type !== "string") malformed();
        if (annotation.type !== "url_citation") continue;
        if (typeof annotation.url !== "string" || /[\s\u0000-\u001f\u007f]/.test(annotation.url)) malformed();
        let url: URL;
        try { url = new URL(annotation.url); } catch { malformed(); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) malformed();
        citations.add(annotation.url);
      }
    }
  }
  if (!text.trim()) throw new SafeError("xAI returned an empty answer.");
  return { text, citations: [...citations] };
}

async function readJson(response: Response, signal: AbortSignal, checkActive: () => void): Promise<unknown> {
  if (!response.body) throw new SafeError("xAI returned an empty response body.");
  const reader = response.body.getReader();
  // Explicit cancellation also stops injected/custom response streams, not just native fetch bodies.
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder();
  let text = "";
  try {
    checkActive();
    while (true) {
      const chunk = await reader.read();
      checkActive();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    let data: unknown;
    try { data = JSON.parse(text); } catch {
      throw new SafeError("xAI returned invalid JSON.");
    }
    checkActive();
    return data;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

/** Total deadline includes fetching headers AND consuming/parsing the response body. */
export async function callXaiApi(
  config: Config,
  query: string,
  tools: Record<string, unknown>[],
  signal: AbortSignal,
): Promise<SearchResult> {
  if (signal.aborted) throw new RequestCancelled();
  const controller = new AbortController();
  const deadline = performance.now() + config.timeoutMs;
  let timedOut = false;
  const stoppedError = () => timedOut
    ? new SafeError("xAI request timed out. Try a narrower query or increase XAI_TIMEOUT_MS.")
    : new RequestCancelled();
  let rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const stop = () => {
    // Do not forward signal.reason: SDK cancellation reasons can contain arbitrary strings.
    rejectAbort(stoppedError());
    controller.abort();
  };
  const checkActive = () => {
    // Also enforce elapsed time when synchronous parsing or ready stream chunks delay timers.
    if (!controller.signal.aborted && performance.now() >= deadline) { timedOut = true; stop(); }
    if (controller.signal.aborted) throw stoppedError();
  };
  signal.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(() => { timedOut = true; stop(); }, config.timeoutMs);
  const operation = async () => {
    const response = await config.fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, input: [{ role: "user", content: query }], tools }),
      signal: controller.signal,
    });
    try { checkActive(); } catch (error) {
      void response.body?.cancel().catch(() => {});
      throw error;
    }
    if (!response.ok) {
      // Never read or forward provider diagnostics, even on HTTP failures.
      void response.body?.cancel().catch(() => {});
      const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
        ? `HTTP ${response.status}` : "invalid HTTP status";
      throw new SafeError(`xAI API request failed (${status}).`);
    }
    const result = extractResult(await readJson(response, controller.signal, checkActive));
    checkActive();
    return result;
  };
  try {
    return await Promise.race([aborted, operation()]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
}

function formatResult({ text, citations }: SearchResult): string {
  return citations.length === 0 ? text
    : `${text}\n\n---\nSources:\n${citations.map((url, i) => `[${i + 1}] ${url}`).join("\n")}`;
}

const querySchema = z.string().trim().min(1, "query must not be empty.");
const domainSchema = z.string().trim()
  .refine((value) => !/[/:\\?#*@%\s]/.test(value), "Use a bare hostname, without scheme, path or wildcards.")
  .transform((value) => domainToASCII(value.replace(/\.$/, "")).toLowerCase())
  .refine((value) => value.length > 0 && value.length <= 253 && value.split(".").every((label) =>
    label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)), "Use a valid bare hostname.");
const handleSchema = z.string().trim().transform((value) => value.replace(/^@/, ""))
  .refine((value) => /^[A-Za-z0-9_]{1,15}$/.test(value), "X handles must contain 1–15 letters, digits or underscores.");

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
const dateSchema = z.string().refine(validDate, "Dates must be valid calendar dates in exact YYYY-MM-DD format.").nullable().optional();

export function createServer(options: ServerOptions): McpServer {
  const config: Config = { ...options, model: options.model ?? DEFAULT_MODEL,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS, fetch: options.fetch ?? globalThis.fetch };
  if (!config.apiKey?.trim()) throw new ConfigurationError("XAI_API_KEY environment variable is required.");
  if (!validTimeout(config.timeoutMs)) {
    throw new ConfigurationError("XAI_TIMEOUT_MS must be a positive integer no greater than 2147483647.");
  }
  if (!isRecord(manifest) || typeof manifest.version !== "string") {
    throw new ConfigurationError("Unable to read server version from package.json.");
  }
  const server = new McpServer({ name: "xai-search", version: manifest.version });
  const run = async (label: string, query: string, tool: Record<string, unknown>, signal: AbortSignal) => {
    try {
      return { content: [{ type: "text" as const, text: formatResult(await callXaiApi(config, query, [tool], signal)) }] };
    } catch (error: unknown) {
      // SDK suppresses cancelled responses. Never turn a cancellation into an upstream failure.
      if (signal.aborted || error instanceof RequestCancelled) throw new RequestCancelled();
      const message = error instanceof SafeError ? error.message : "The request could not be completed.";
      return { content: [{ type: "text" as const, text: `${label} failed: ${message}` }], isError: true };
    }
  };
  const invalid = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

  server.tool("web_search", "Search the web in real-time using xAI. Returns results with source citations.", {
    query: querySchema.describe("The search query"),
    allowed_domains: z.array(domainSchema).max(5).nullable().optional()
      .describe("Only search within these bare hostnames (max 5). Cannot be used with excluded_domains."),
    excluded_domains: z.array(domainSchema).max(5).nullable().optional()
      .describe("Exclude these bare hostnames from search (max 5). Cannot be used with allowed_domains."),
  }, async (params, extra) => {
    const allowed = params.allowed_domains?.length ? params.allowed_domains : undefined;
    const excluded = params.excluded_domains?.length ? params.excluded_domains : undefined;
    if (allowed && excluded) return invalid("allowed_domains and excluded_domains cannot be used together.");
    const tool: Record<string, unknown> = { type: "web_search" };
    if (allowed) tool.filters = { allowed_domains: allowed };
    if (excluded) tool.filters = { excluded_domains: excluded };
    return run("Web search", params.query, tool, extra.signal);
  });

  server.tool("x_search", "Search X (Twitter) posts, users, and threads in real-time using xAI. Returns results with source citations.", {
    query: querySchema.describe("The search query for X posts"),
    allowed_x_handles: z.array(handleSchema).max(10).nullable().optional()
      .describe("Only consider posts from these X handles (max 10). Optional leading @. Cannot be used with excluded_x_handles."),
    excluded_x_handles: z.array(handleSchema).max(10).nullable().optional()
      .describe("Exclude posts from these X handles (max 10). Optional leading @. Cannot be used with allowed_x_handles."),
    from_date: dateSchema.describe("Inclusive start date in exact YYYY-MM-DD format."),
    to_date: dateSchema.describe("Exclusive end date in exact YYYY-MM-DD format."),
  }, async (params, extra) => {
    const allowed = params.allowed_x_handles?.length ? params.allowed_x_handles : undefined;
    const excluded = params.excluded_x_handles?.length ? params.excluded_x_handles : undefined;
    if (allowed && excluded) return invalid("allowed_x_handles and excluded_x_handles cannot be used together.");
    if (params.from_date && params.to_date && params.from_date > params.to_date) {
      return invalid("from_date must not be later than to_date.");
    }
    const tool: Record<string, unknown> = { type: "x_search" };
    if (allowed) tool.allowed_x_handles = allowed;
    if (excluded) tool.excluded_x_handles = excluded;
    if (params.from_date) tool.from_date = params.from_date;
    if (params.to_date) tool.to_date = params.to_date;
    return run("X search", params.query, tool, extra.signal);
  });
  return server;
}
