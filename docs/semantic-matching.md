# Semantic matching (embeddings)

An opt-in layer that adds embedding-based understanding on top of the
deterministic keyword/cluster matcher, targeting its two biggest limits (from the
matching audit):

1. **Rescue** — a vacancy whose **title wording isn't in the hand-maintained
   keyword lists** but is genuinely in the candidate's field was silently dropped.
   The semantic layer rescues it when its embedding is close enough to the
   candidate's core occupation.
2. **Ranking** — occupation relevance was binary (32-or-0), so within a field
   everything scored the same. A small bonus (0–`SEMANTIC_BONUS_MAX`) by semantic
   closeness now differentiates (a Koch job ranks above a same-cluster Spülkraft
   one for a Koch candidate).

## It never crosses fields

The semantic layer runs **after** the hard cross-field cluster gate in
`scoring.ts`. A logistics candidate can't be pulled into IT: cross-field pairs are
already blocked before semantics is consulted, and cosine similarity between
unrelated occupations is low anyway. The operator's core rule ("don't cross
fields") is preserved.

## Fully gated — off by default

No behaviour changes unless **both**:
- `SEMANTIC_MATCH_ENABLED="true"`, and
- an embedding provider key is set: `VOYAGE_API_KEY` (preferred — Anthropic's
  recommended embeddings partner) or `OPENAI_API_KEY`.

Otherwise `prepareSemanticMatcher` returns null and scores are byte-for-byte the
deterministic result.

## Cost & caching

Vectors are cached in Postgres (`EmbeddingCache`, keyed by `hash(model + text)`),
so each distinct vacancy title is embedded **once** and reused across candidates
and runs. Per run: one provider call for the candidate core + one batched call for
any not-yet-cached titles. Cosine similarity is computed in JS (no pgvector).

## Tunables (`.env`)

| var | default | meaning |
|---|---|---|
| `SEMANTIC_MATCH_ENABLED` | `false` | master switch |
| `VOYAGE_API_KEY` / `OPENAI_API_KEY` | — | provider key (set one) |
| `EMBEDDING_MODEL` | `voyage-3-lite` / `text-embedding-3-small` | model override |
| `SEMANTIC_RESCUE_THRESHOLD` | `0.6` | min cosine to rescue a keyword-missed job |
| `SEMANTIC_BONUS_MAX` | `12` | max fitScore points from semantic closeness |

## Rollout

1. Set a provider key + `SEMANTIC_MATCH_ENABLED=true`. Trigger a re-match (nightly
   or `/api/cron/maintenance?job=refresh`).
2. First run embeds the current vacancy pool once (cached thereafter).
3. Watch candidate match lists: rescued jobs are ones with correct-field titles
   the keyword lists missed. Raise `SEMANTIC_RESCUE_THRESHOLD` if anything
   off-field slips in, lower it to rescue more aggressively.
