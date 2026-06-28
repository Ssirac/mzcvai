import Anthropic from "@anthropic-ai/sdk";

/**
 * Shared Anthropic client with built-in resilience.
 *
 * The SDK automatically retries connection errors (incl. transient DNS failures
 * like ENOTFOUND) and 429/5xx responses with exponential backoff. We raise the
 * retry count and timeout so the occasional flaky-DNS hiccup self-heals instead
 * of failing "Müraciət yaz" / CV parsing.
 */
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxRetries: 5,
  timeout: 60_000,
});
