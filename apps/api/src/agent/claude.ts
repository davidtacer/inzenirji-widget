import type { Usage } from "./pricing.ts";

/** Minimal Anthropic Messages API types used by the agent. */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ModelRequest {
  model: string;
  system: string;
  tools: ToolDef[];
  messages: Message[];
  maxTokens: number;
}

export interface ModelResponse {
  content: ContentBlock[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "refusal" | string;
  usage: Usage;
}

export type CallModel = (req: ModelRequest) => Promise<ModelResponse>;

export class ModelError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ModelError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Calls the Messages API with prompt caching on the system prompt and tools (they are the same for every
 * message of a site, so repeat calls in the tool loop read them from the cache).
 */
export function anthropicCaller(
  apiKey: string,
  fetchImpl: FetchLike = (i, init) => fetch(i, init),
): CallModel {
  return async (req) => {
    const tools = req.tools.map((t, i) =>
      i === req.tools.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t,
    );
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens,
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        tools,
        messages: req.messages,
      }),
    });
    if (!res.ok) {
      // Error bodies can echo request content; keep only the status and error type.
      let type = "unknown";
      try {
        type = ((await res.json()) as { error?: { type?: string } }).error?.type ?? "unknown";
      } catch {
        // ignore
      }
      throw new ModelError(res.status, `Anthropic API ${res.status} ${type}`);
    }
    const data = (await res.json()) as {
      content: ContentBlock[];
      stop_reason: string;
      usage: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
    };
    return {
      content: data.content,
      stopReason: data.stop_reason,
      usage: {
        input: data.usage.input_tokens ?? 0,
        output: data.usage.output_tokens ?? 0,
        cacheRead: data.usage.cache_read_input_tokens ?? 0,
        cacheWrite: data.usage.cache_creation_input_tokens ?? 0,
      },
    };
  };
}
