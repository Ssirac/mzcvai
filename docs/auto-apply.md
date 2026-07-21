# Auto-apply engine (FORM applications)

Server-side, headless-Puppeteer submission of FORM-based job applications — the
automated counterpart to the human MZ Autofill browser extension. It fills a
German application form with the **same field mapping** the extension uses
(`src/lib/applicationFields.ts` + `src/lib/formFill.ts`) and, when explicitly
enabled, clicks submit on captcha-free forms.

> **Compliance note.** Auto-submitting applications on a candidate's behalf is a
> deliberate departure from the system's original human-in-the-loop design. It is
> a decision the system owner made and is responsible for. The rails below keep
> it controlled; keep the human queue as the path for anything the engine can't
> complete cleanly. This is not legal advice — consult a GDPR/UWG lawyer before
> scaling.

## Safety rails (all enforced in `src/services/autoApply.ts`)

1. **OFF by default** — nothing runs unless `AUTO_FORM_APPLY_ENABLED="true"`.
2. **DRY-RUN by default** — even when enabled, it fills + reports and **never
   submits** until `AUTO_FORM_APPLY_DRY_RUN="false"`.
3. **captcha / OTP / login → human** — never auto-handled; routed to the existing
   robot queue (`enqueueCaptcha`), exactly as the human flow.
4. **No garbage submissions** — if any **required** field is still empty after the
   fill, the job goes to the human queue instead of being submitted.
5. **Legal consent** — required privacy/consent checkboxes are auto-ticked **only**
   when `AUTO_FORM_APPLY_ACCEPT_CONSENT="true"` (default off). Otherwise they read
   as missing-required → human.
6. **Dedupe** — a pairing already applied/queued is never redone.
7. **Opt-out + completeness** — opted-out employers, and candidates without a CV /
   e-mail / phone, are skipped.
8. **Daily cap** — `AUTO_FORM_APPLY_DAILY_CAP` real submissions per day.
9. **SSRF guard** — the browser is never pointed at a private host.

Every action is written to `JobApplicationLog` (audit trail).

## Flags

See `.env.example`. Summary: `AUTO_FORM_APPLY_ENABLED`,
`AUTO_FORM_APPLY_DRY_RUN`, `AUTO_FORM_APPLY_ACCEPT_CONSENT`,
`AUTO_FORM_APPLY_REQUIRE_CV`, `AUTO_FORM_APPLY_DAILY_CAP`,
`AUTO_FORM_APPLY_LIMIT`, `AUTO_FORM_APPLY_INTERVAL_HOURS`.

## Statuses written to JobApplicationLog

| status | meaning |
|---|---|
| `WOULD_APPLY` | dry-run: all required fields filled, would have submitted |
| `APPLIED` | submitted and a success acknowledgement was seen on the page |
| `APPLIED_UNCONFIRMED` | submitted, but no confirmation text detected — verify manually |
| `NEEDS_HUMAN` | filled but a required field / submit button was missing → queued |
| `WAITING_CAPTCHA` / `WAITING_OTP` / `WAITING_LOGIN` | blocked class → human queue |
| `BLOCKED` / `DEAD` / `NO_FORM` / `ERROR` | not applied (see note column) |

## Recommended rollout

1. Enable with dry-run: `AUTO_FORM_APPLY_ENABLED=true`, leave
   `AUTO_FORM_APPLY_DRY_RUN=true`. Let it run, then read `JobApplicationLog` — the
   `WOULD_APPLY` rows show which forms it filled completely and how many fields.
2. Spot-check a few of those forms manually to confirm the fill quality.
3. Only then set `AUTO_FORM_APPLY_DRY_RUN=false`, starting with a low
   `AUTO_FORM_APPLY_DAILY_CAP`, and decide on `AUTO_FORM_APPLY_ACCEPT_CONSENT`
   deliberately.

## How it's triggered

Opt-in cron job `autoapply` (heavy, detached) via `/api/cron/maintenance?job=autoapply`,
and the in-process scheduler fires it every `AUTO_FORM_APPLY_INTERVAL_HOURS` when
enabled. Runs are serialised by a cron lock so a long browser pass never overlaps.
