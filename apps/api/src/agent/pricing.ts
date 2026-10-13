/**
 * AI cost of an edit in integer micro-euros (ADR-005). Prices in USD per million tokens.
 * Source: third-party summaries of Anthropic's price list (2026-10-13); verify against
 * https://platform.claude.com/docs/en/about-claude/pricing before charging clients.
 */
export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

interface PriceRow {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number; // 5-minute cache write
}

const PRICES: Record<string, { base: PriceRow; over100k?: PriceRow }> = {
  "claude-sonnet-5-5": { base: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } },
  "claude-haiku-5-5": {
    base: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
    // Haiku 5.5 bills every line at a higher rate when one request's prompt exceeds 100k tokens.
    over100k: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
  },
};

export function isKnownModel(model: string): boolean {
  return model in PRICES;
}

/** Cost of one request in micro-USD (float). */
function requestMicroUsd(model: string, u: Usage): number {
  const table = PRICES[model];
  if (!table) throw new Error(`no price for model ${model}`);
  const promptTokens = u.input + u.cacheRead + u.cacheWrite;
  const p = table.over100k && promptTokens > 100_000 ? table.over100k : table.base;
  // USD per million tokens × tokens = micro-USD
  return u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite;
}

/** Sum of all model requests of one edit, converted to micro-euros and rounded up. */
export function costMicros(model: string, requests: Usage[], usdToEur: number): number {
  const microUsd = requests.reduce((sum, u) => sum + requestMicroUsd(model, u), 0);
  return Math.ceil(microUsd * usdToEur);
}

/** Client price in integer cents: cost × margin, rounded up to the next cent (1 cent = 10 000 micro-euros). */
export function priceCents(costMicroEur: number, margin: number): number {
  if (costMicroEur <= 0) return 0;
  return Math.ceil((costMicroEur * margin) / 10_000);
}

export function sumUsage(requests: Usage[]): Usage {
  return requests.reduce(
    (a, u) => ({
      input: a.input + u.input,
      output: a.output + u.output,
      cacheRead: a.cacheRead + u.cacheRead,
      cacheWrite: a.cacheWrite + u.cacheWrite,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  );
}
