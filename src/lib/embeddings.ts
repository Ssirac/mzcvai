/**
 * Text embeddings for semantic matching — provider-agnostic + cached.
 *
 * Anthropic has no embeddings endpoint, so this uses an external provider when a
 * key is present: Voyage AI (Anthropic's recommended embeddings partner) or
 * OpenAI. With NO key, embeddingsAvailable() is false and everything no-ops, so
 * the deterministic matcher is completely unaffected until a key is configured.
 *
 * Vectors are cached in Postgres (EmbeddingCache) keyed by hash(model + text), so
 * an identical vacancy title is embedded once and reused across candidates and
 * runs — the per-run cost is only genuinely-new text. Cosine similarity is
 * computed in JS (no pgvector needed).
 */

import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";

interface Provider { name: "voyage" | "openai"; key: string; model: string; endpoint: string }

function provider(): Provider | null {
  if (process.env.VOYAGE_API_KEY) {
    return { name: "voyage", key: process.env.VOYAGE_API_KEY, model: process.env.EMBEDDING_MODEL || "voyage-3-lite", endpoint: "https://api.voyageai.com/v1/embeddings" };
  }
  if (process.env.OPENAI_API_KEY) {
    return { name: "openai", key: process.env.OPENAI_API_KEY, model: process.env.EMBEDDING_MODEL || "text-embedding-3-small", endpoint: "https://api.openai.com/v1/embeddings" };
  }
  return null;
}

export function embeddingsAvailable(): boolean {
  return provider() !== null;
}

function normalize(t: string): string {
  return (t || "").toLowerCase().replace(/\s+/g, " ").trim();
}
function hashOf(model: string, normText: string): string {
  return createHash("sha1").update(`${model}\n${normText}`).digest("hex");
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function callProvider(p: Provider, texts: string[]): Promise<number[][]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(p.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: texts, model: p.model }),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as { data?: { embedding: number[]; index?: number }[]; error?: { message?: string } };
    if (!res.ok || !data.data) throw new Error(data.error?.message || `embed HTTP ${res.status}`);
    // Both providers return data[].embedding; sort by index defensively (OpenAI
    // includes it, Voyage returns in order).
    return data.data.slice().sort((x, y) => (x.index ?? 0) - (y.index ?? 0)).map((d) => d.embedding);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Embed a list of texts, using and populating the cache. Returns vectors aligned
 * to the input (null for any text that couldn't be embedded — fail-soft). Returns
 * all-null when no provider is configured.
 */
export async function embedTexts(texts: string[]): Promise<(number[] | null)[]> {
  const p = provider();
  if (!p) return texts.map(() => null);

  const norm = texts.map(normalize);
  const hashes = norm.map((t) => hashOf(p.model, t));
  const uniqueHashes = Array.from(new Set(hashes));

  const byHash = new Map<string, number[]>();
  try {
    const cached = await prisma.embeddingCache.findMany({
      where: { hash: { in: uniqueHashes } },
      select: { hash: true, vector: true },
    });
    for (const c of cached) byHash.set(c.hash, c.vector as number[]);
  } catch { /* cache read failure → treat as all-miss */ }

  // Unique misses, with a representative text for each.
  const missHashes: string[] = [];
  const missTexts: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < hashes.length; i++) {
    const h = hashes[i];
    if (byHash.has(h) || seen.has(h)) continue;
    seen.add(h); missHashes.push(h); missTexts.push(norm[i]);
  }

  const CHUNK = p.name === "voyage" ? 128 : 256;
  for (let i = 0; i < missTexts.length; i += CHUNK) {
    const chunkTexts = missTexts.slice(i, i + CHUNK);
    const chunkHashes = missHashes.slice(i, i + CHUNK);
    let vecs: number[][];
    try {
      vecs = await callProvider(p, chunkTexts);
    } catch {
      continue; // those stay null (fail-soft)
    }
    for (let j = 0; j < vecs.length && j < chunkHashes.length; j++) {
      const vec = vecs[j];
      byHash.set(chunkHashes[j], vec);
      await prisma.embeddingCache.upsert({
        where: { hash: chunkHashes[j] },
        create: { hash: chunkHashes[j], model: p.model, dim: vec.length, vector: vec },
        update: {},
      }).catch(() => {});
    }
  }

  return hashes.map((h) => byHash.get(h) ?? null);
}
