# Job-Source Modules — Developer Guide

Each job platform is a **self-contained module**. Adding, updating, or removing a
platform touches **only its module** — nothing else in the system.

## Architecture

```
src/services/
  arbeitsagentur.ts   ← module (live)
  arbeitnow.ts        ← module (live)
  adzuna.ts           ← module (live)
  jooble.ts           ← module (key needed)
  sources/
    registry.ts       ← registers every module + the JobSource interface
```

Every module exposes one function with the shared signature:

```ts
ingestX(opts: IngestOptions): Promise<IngestResult>
// IngestOptions = { beruf, region, keywords?, maxPages? }
// IngestResult  = { vacanciesNew, vacanciesUpdated, employersNew, errors }
```

The **registry** wraps each module behind the `JobSource` interface:

```ts
interface JobSource {
  id: string;                 // "stepstone"
  label: string;              // "StepStone"
  category: "general" | "hospitality";
  available(): boolean;       // configured & usable right now?
  unavailableReason?: string; // shown in the UI when not available
  ingest(opts): Promise<IngestResult>;
}
```

`POST /api/ingest` runs the selected module (or all available ones for `source:"all"`).
`GET /api/ingest` lists every module + its availability (the dashboard renders this).

## How to add a new platform (3 steps)

1. **Create the module** `src/services/<platform>.ts` — fetch, map each job to the
   DB shape, upsert employer + vacancy with `source: "<platform>"`. Copy
   `adzuna.ts` as a template.
2. **Register it** in `src/services/sources/registry.ts`: add a `JobSource`
   entry and push it into `SOURCES`.
3. **(If it needs a key)** add the env var and gate `available()` on it.

That's it — the dashboard selector, `/api/ingest`, and "all sources" pick it up
automatically. No other file changes.

## Platform status (Germany)

| Platform | Module | Status | What it needs |
|----------|--------|--------|---------------|
| Bundesagentur für Arbeit | `arbeitsagentur.ts` | ✅ Live | Public API (free) |
| Adzuna (aggregates boards + company pages) | `adzuna.ts` | ✅ Live | Free key (set) |
| Arbeitnow | `arbeitnow.ts` | ✅ Live | Public API (free) |
| Jooble | `jooble.ts` | 🔑 Ready | Free key — `JOOBLE_API_KEY` |
| HOGAPAGE (Hotel & Gastro) | placeholder | 🔒 Planned | No public API — needs partner feed / agreement |
| Hotelcareer | placeholder | 🔒 Planned | No public API — partner feed |
| Indeed Germany | placeholder | 🔒 Planned | Publisher API closed to new users — partner/paid |
| StepStone | placeholder | 🔒 Planned | No public API — partner/paid |
| LinkedIn Jobs | placeholder | 🔒 Planned | Partner Program only (no scraping) |
| XING Jobs | placeholder | 🔒 Planned | No public API |
| Company career pages (direct) | placeholder | 🔒 Planned | Per-company integration |

### Legal note
LinkedIn, XING, StepStone, Indeed, HOGAPAGE and Hotelcareer do **not** offer a
free public job-search API for this use case, and scraping them violates their
Terms of Service (and German UWG/legal risk). The placeholders are wired so that
once an **official partner feed / paid API** is obtained, the only work is to
fill in that one module.

**Good news:** Adzuna already aggregates listings *from* StepStone, Indeed and
many company career pages — so a large share of those vacancies is covered today
through the legal Adzuna module.

## Recommended priority (hospitality first)
The owner's core market is hotels & restaurants. Start by sourcing hospitality
roles via the **live** modules (Adzuna + Bundesagentur + Arbeitnow already return
Koch/Service/Housekeeping/Hotel jobs), then add a partner feed for **HOGAPAGE /
Hotelcareer** when available.
