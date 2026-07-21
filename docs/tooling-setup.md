# External tooling & MCP setup

A catalog of the third-party tools evaluated for this project, with an honest
verdict for **this** codebase (a Next.js 16 / TypeScript / Prisma 7 recruiting
console that sends GDPR-sensitive outreach email and scrapes job boards), the
exact way to install each, and its status.

> **Why not "just install everything":** most of these are **client-side MCP
> servers** — they run in *your* Claude Code, not inside this repo, and need
> *your* API keys. Others are separate Python services or unrelated apps. Piling
> six or seven external dependencies + secrets onto a production GDPR system adds
> real cost and risk with little payoff. The two that actually fit this codebase
> are wired up in `.mcp.json`; the rest are documented here so you can enable any
> of them deliberately.

Legend: ✅ recommended & wired · ◐ useful, key-gated (enable when needed) ·
⚠️ situational · ❌ not recommended for this repo.

---

## ✅ Wired in `.mcp.json` (add the key → it works)

### context7 — up-to-date library docs (`upstash/context7`)
Injects current, version-specific docs for the libraries you use. **High value
here** because this repo runs bleeding-edge versions (Next 16, React 19,
Prisma 7, next-intl 4) where a model's training data is easily stale.

- Already in `.mcp.json` as `context7` (`npx -y @upstash/context7-mcp`).
- Optional higher rate limit: set `CONTEXT7_API_KEY` (get it via `npx ctx7 setup`).
- Use: reference a library by id, e.g. `/vercel/next.js`, `/prisma/prisma`.

### firecrawl — web scraping / crawling API (`firecrawl/firecrawl`)
Turns pages into clean markdown/JSON, handles JS rendering, proxies, rate limits.
**Fits** the job-ingestion side (you already use puppeteer + cheerio).

- Already in `.mcp.json` as `firecrawl` (`npx -y firecrawl-mcp`).
- **Required:** `FIRECRAWL_API_KEY` (free tier at firecrawl.dev), or self-host
  the AGPL-3.0 server and point at it.

---

## Claude Code subagents

### wshobson/agents — 200+ domain subagents
Not an MCP — a **plugin marketplace**. Install via your Claude Code client
(these are markdown personas; no keys, no runtime):

```
/plugin marketplace add wshobson/agents
/plugin install code-review        # code-reviewer
/plugin install security           # security-auditor
/plugin install databases          # sql-pro, database-optimizer
```

Most useful for this repo: **code-reviewer, security-auditor,
database-optimizer, typescript-pro, debugger** (plus backend-architect,
error-detective, deployment-engineer / devops-troubleshooter).

---

## ◐ / ⚠️ Documented — enable deliberately

### mem0ai/mem0 — long-term memory for agents
Ready-to-paste `.mcp.json` entry (needs a Mem0 key or a self-hosted vector store):

```jsonc
"mem0": { "command": "npx", "args": ["-y", "@mem0/mcp-server"], "env": { "MEM0_API_KEY": "${MEM0_API_KEY}" } }
```
⚠️ Verify the exact package name against the mem0 README before enabling. Fit for
this backend is unclear — the app already has its own Postgres state.

### zilliztech/claude-context — semantic code search (MCP)
❌ **Redundant with context7** for retrieval, and needs a Milvus/Zilliz vector DB
+ an embedding key. Only worth it once this repo is much larger. Skip for now.

### czlonkowski/n8n-mcp — n8n workflow automation (MCP)
⚠️ Only relevant if you actually run n8n. Not part of this stack today.

### browser-use/browser-use · browser-use/browser-harness
⚠️ Python browser-automation agents (Playwright + an LLM key). Could power the
`applyScanner` form-fill path, but they are a **separate Python service** and
fully automating GDPR/UWG-sensitive application submissions reduces the
human-approval control this system deliberately keeps. Consider only if the
form-apply volume outgrows manual confirmation.

---

## ❌ Not related to this recruiting backend
Documented for completeness — evaluated and left out:

- **bradautomates/claude-video** — video generation workflow.
- **nexu-io/open-design** — design tooling.
- **getagentseal/codeburn**, **pbakaus/impeccable**, **santifer/career-ops** —
  not verified; nothing indicates a fit for this codebase. Not installed.

---

_Keys for the wired servers live in the environment (Railway / local `.env`),
never committed. See `.env.example`._
