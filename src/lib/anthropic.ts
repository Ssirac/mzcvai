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

/**
 * Extract the full text from a Messages API response. NEVER assume the text is
 * in content[0]: newer models (Sonnet 5+) may emit a thinking block first, in
 * which case `content[0].type === "text"` is false — that silent "" produced
 * 41 boilerplate-only application letters on 13–14 July before it was caught.
 */
export function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
