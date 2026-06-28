# MZ Talent Intelligence

Recruiting console that connects Azerbaijani hospitality/trade candidates with German employers, prioritising employers that are likely to sponsor a work visa.

It ingests live vacancies from public job sources, scores employers (sponsorship‑dominant), matches them to candidate CVs, and lets a human approve and send outreach — all behind an admin login, in **Azerbaijani / German / English**.

---

## Features

- **Job ingestion** — Bundesagentur für Arbeit (national German job DB) + Arbeitnow (visa‑sponsorship board), any occupation, all of Germany.
- **Sponsorship‑dominant scoring** — employers ranked by likelihood to sponsor (40 % of the score), plus vacancy/channel/behaviour/context.
- **CV → matches** — add a candidate (or upload a CV PDF; Claude extracts the fields) and instantly get ranked matching jobs, each with a direct link.
- **Human‑supervised outreach** — Claude drafts a German cover letter; a recruiter approves before anything is sent. Per‑candidate communication history.
- **GDPR/UWG guards** — generic company emails only (never personal HR addresses), daily send cap, per‑employer cooldown.
- **Security** — admin login gate on every page and API, signed session cookie, brute‑force throttle, CSRF origin check, CSP + security headers.

## Tech

Next.js 14 (App Router) · TypeScript · Prisma 7 + PostgreSQL · next‑intl · Tailwind · Anthropic Claude · Nodemailer.

---

## Setup

1. **Install**
   ```bash
   npm install
   ```

2. **Configure** — copy `.env.example` to `.env` and fill it in:
   ```bash
   cp .env.example .env
   ```
   | Variable | Purpose |
   |----------|---------|
   | `DATABASE_URL` | PostgreSQL connection string |
   | `NEXTAUTH_SECRET` | long random string — signs the session cookie |
   | `ADMIN_USER` / `ADMIN_PASSWORD` | admin login that protects the whole panel |
   | `ANTHROPIC_API_KEY` | Claude API key (CV parsing + cover letters) |
   | `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | outbound email |
   | `MAX_OUTREACH_PER_DAY` / `OUTREACH_COOLDOWN_DAYS` | send‑rate safety limits |
   | `CRON_SECRET` | protects the nightly cron endpoint |

3. **Database**
   ```bash
   npx prisma db push      # create tables
   npx prisma generate     # generate client
   ```

4. **Run**
   ```bash
   npm run dev             # http://localhost:3000  (redirects to /login)
   ```

## Build & deploy

```bash
npm run build
npm run start
```

Before going live: serve over **HTTPS**, set a strong `ADMIN_PASSWORD` and `NEXTAUTH_SECRET`, use a strong DB password, and **rotate any key that was ever shared in chat/email**.

## Routes

- `/[locale]/login` — admin login (`az` | `de` | `en`)
- `/[locale]/dashboard` — stats, job ingestion, outreach queue, top employers
- `/[locale]/candidates` — candidate CRUD, CV upload, matches, communication history
- `/api/health` — liveness + DB check (public, for uptime monitoring)

## Notes

- Internal tool — excluded from search engines (`robots: noindex`).
- Remaining `npm audit` advisories require a Next.js major upgrade and are mostly DoS / not applicable to this configuration; the critical middleware‑bypass fix is already included in the pinned version.
- This is not legal advice — consult a German GDPR/UWG lawyer before scaling outreach.
