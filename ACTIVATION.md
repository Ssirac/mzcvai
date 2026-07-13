# Aktivləşdirmə checklist (MZ Personalvermittlung)

Kod tam hazırdır. Sistemin **uçdan-uca** işləməsi üçün yalnız aşağıdakılar sizin
tərəfinizdən lazımdır — bunları kod edə bilmir (billing / Railway dashboard /
sizin kompüter).

## 1. Anthropic kredit
Müraciət və xatırlatma məktubları Claude (Sonnet 5) ilə yazılır.
- console.anthropic.com → Plans & Billing → kredit əlavə edin.
- Kredit bitsə: scraping/matching işləyir, **məktub göndərmə uğursuz olur**.
- Təxmini xərc: ~$0.013/məktub (Sonnet). CV oxuma bir dəfə ~$0.09/namizəd.

## 2. Railway environment dəyişənləri

### Avtomatik göndəriş (default BAĞLIDIR — təhlükəsizlik)
```
AUTO_SEND_ENABLED=true          # köhnə autopilot (namizəd adı ilə, 20/gün)
MAX_OUTREACH_PER_DAY=20
GLOBAL_DAILY_CAP=400            # ~20 × namizəd sayı
# AUTO_EMAIL_ENABLED=true       # ALTERNATİV: governed axın (consent+review tələb edir)
```
⚠️ UWG/deliverability riski — bounce auto-pause (10%) qoruyur, amma diqqətli olun.

### Apply scanner (form işləri + robot növbəsi)
```
APPLY_SCAN_ENABLED=true
APPLY_SCAN_INTERVAL_HOURS=6
```

### Deliverability / bounce
```
AUTO_SEND_PAUSED=false          # manual kill switch (true = hamısı dayanır)
BOUNCE_PAUSE_RATE=0.1           # 10% bounce → avto-pause
```

### Scraping cadence
```
SCRAPE_INTERVAL_HOURS=1         # saat başı (default)
DEAD_SWEEP_ENABLED=true
```

### Attribution (opsional)
```
OUTREACH_CAMPAIGN=default
OUTREACH_TEMPLATE_VERSION=de-v1
```

### Mütləq olmalı (yoxsa app degraded)
`DATABASE_URL`, `NEXTAUTH_SECRET`, `CRON_SECRET`, `ADMIN_USER`, `ADMIN_PASSWORD`,
`ANTHROPIC_API_KEY`, və mail (SMTP_* / RESEND_API_KEY / GMAIL_*).

Statusu yoxlamaq: **/system** səhifəsi və ya `GET /api/health` (yalnız boolean-lar).

## 3. MZ Autofill extension (Chrome)
1. `chrome://extensions` → Developer mode → **Load unpacked** → `extension/` qovluğu.
2. MZ-də login → extension popup → Baza URL + namizəd seç → Save.
3. İş formasında captcha-nı özün keç → "MZ: Daten ausfüllen" → sahələr + CV dolur.

## Edilə BİLMƏYƏNlər (texniki/hüquqi)
- StepStone, Indeed, LinkedIn, XING, Monster, Meinestadt, Kimeta, JobNinja —
  anti-bot (Akamai/Cloudflare); rəsmi partner API lazımdır.
- Captcha avtomatik keçmək — qadağan (human-in-the-loop: CaptchaQueue + extension).

## DB miqrasiyası
Avtomatikdir: Dockerfile hər deploy-da `prisma db push` işlədir, ona görə schema
production-da özü tətbiq olunur. Əl ilə heç nə lazım deyil.
