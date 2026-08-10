# Sending from a Gmail account (Gmail API)

The mailer picks a provider in this order: **Gmail API → Resend → SMTP**
(`src/lib/mailer.ts`). Setting the three `GMAIL_*` values below switches all
outbound mail to the Gmail API — the mail genuinely comes **from** that Gmail
address. No code change is needed.

> Default sender: if `GMAIL_SENDER` is unset it defaults to
> `germanycareercenter1@gmail.com`.

## What you need (Railway env)

```
GMAIL_CLIENT_ID=xxxx.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=xxxx
GMAIL_REFRESH_TOKEN=1//xxxx
REPLY_TO=info@mz-personalvermittlung.de        # replies land in the monitored IONOS inbox
# GMAIL_SENDER=germanycareercenter1@gmail.com   # optional — this is the default
```

Only the account owner can perform the Google steps below (Google requires the
human to authorize; it cannot be automated).

## Step by step

### A. Google Cloud project + Gmail API
1. https://console.cloud.google.com — sign in as the sending Gmail.
2. Project dropdown → **New Project** (`MZ Mailer`) → create → select it.
3. Search **"Gmail API"** → **Enable**.

### B. OAuth consent screen
4. **APIs & Services → OAuth consent screen** → User Type **External** → Create.
5. App name `MZ Mailer`; support + developer email = the Gmail → Save & Continue.
6. Scopes → Save & Continue (skip).
7. **Test users → Add** the sending Gmail → Save.
8. **IMPORTANT: click "Publish App".** If it stays in *Testing*, the refresh
   token **expires after 7 days** and sending stops.

### C. OAuth client (Client ID / Secret)
9. **Credentials → Create Credentials → OAuth client ID**.
10. Application type **Web application**, name `MZ Mailer`.
11. **Authorized redirect URIs → Add** `https://developers.google.com/oauthplayground`.
12. Create → copy the **Client ID** and **Client secret**.

### D. Refresh token (OAuth Playground)
13. https://developers.google.com/oauthplayground
14. Gear ⚙️ (top-right) → tick **Use your own OAuth credentials** → paste Client ID + Secret.
15. Left panel **Input your own scopes** → `https://www.googleapis.com/auth/gmail.send` → **Authorize APIs**.
16. Sign in as the Gmail; if "unverified app" appears → *Advanced → Go to MZ Mailer* → Allow.
17. Click **Exchange authorization code for tokens** → copy the **Refresh token** (`1//…`).

### E. Railway
18. Set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, and
    `REPLY_TO`. Deploy.

### F. Verify
19. Admin-login, then hit `GET /api/smtp-test?to=you@example.com`. Expect
    `{"provider":"gmail","id":"…"}` and a mail arriving **from** the Gmail address.

## Notes / cautions
- **Reply capture:** replies to a Gmail-sent mail would land in the Gmail inbox;
  `REPLY_TO` above routes them to the IONOS inbox the poller already reads, so no
  reply-capture change is needed.
- **Limits:** free Gmail ≈ 500 recipients/day; Google Workspace ≈ 2000. Warm up
  volume gradually — a sudden spike of cold outreach risks suspension.
- **Tracking:** Resend's delivered/opened/bounced webhooks do **not** apply to
  Gmail-sent mail, so the bounce-based auto-pause guard won't see Gmail bounces.
- **Deliverability/trust:** a company-domain address (`info@…`) with proper
  SPF/DKIM/DMARC generally earns more trust from German employers than a
  `@gmail.com` sender — consider that trade-off.
