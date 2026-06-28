# Railway-ə Deploy — Addım-addım bələdçi

Bu sənəd MZ Talent Intelligence saytını **Railway**-ə yükləyib internetə çıxarmaq üçündür.
Nəticədə sayt `https://....up.railway.app` ünvanında işləyəcək, sonra onu
`app.mz-personalvermittlung.de` alt-domeninə bağlayacağıq.

Hazırladığım fayllar (artıq layihədə var):
- `Dockerfile` — server üçün konteyner (Chromium daxil, CV PDF və enrichment üçün)
- `.dockerignore`
- `railway.json` — Railway konfiqurasiyası (health-check `/api/health`)

---

## 0. Lazım olanlar
- **GitHub hesabı** (pulsuz) — https://github.com/signup
- **Railway hesabı** (pulsuz başlanğıc, sonra ~$5/ay) — https://railway.app
- Kodun GitHub-a yüklənməsi (aşağıda)

---

## 1. Kodu GitHub-a yüklə

PowerShell-də layihə qovluğunda (`C:\Users\LOQ\Desktop\mzaicv`):

```powershell
git add -A
git commit -m "Deploy hazırlığı: Dockerfile + Railway config"
```

Sonra GitHub-da **boş** repo yarat (https://github.com/new → ad: `mz-talent`, **Private** seç,
README ƏLAVƏ ETMƏ). Yaranan səhifədəki ünvanı götür və:

```powershell
git remote add origin https://github.com/SƏNİN_ADIN/mz-talent.git
git branch -M main
git push -u origin main
```

> ⚠️ `.env` faylı GitHub-a getmir (`.gitignore`-dadır) — yaxşıdır, parollar gizli qalır.
> Parolları Railway-də ayrıca yazacağıq (Addım 4).

---

## 2. Railway-də layihə yarat

1. https://railway.app → **Login with GitHub**
2. **New Project** → **Deploy from GitHub repo**
3. `mz-talent` reposunu seç → Railway avtomatik `Dockerfile`-ı tapıb build edəcək.

İlk build təxminən 3–5 dəqiqə çəkir (Chromium yüklənir).

---

## 3. PostgreSQL bazası əlavə et

1. Həmin layihənin içində **New** → **Database** → **Add PostgreSQL**.
2. Railway avtomatik `DATABASE_URL` dəyişəni yaradır.
3. Onu app servisinə bağlamaq üçün: app servisinə klik → **Variables** →
   **New Variable** → **Add Reference** → `DATABASE_URL` seç (Postgres-dən).

> Konteyner başlayanda `prisma db push` avtomatik cədvəlləri yaradır (Dockerfile-da var).

---

## 4. Environment dəyişənləri (Variables)

App servisi → **Variables** → bunları əlavə et (dəyərləri öz `.env`-dən götür):

| Açar | Dəyər |
|------|-------|
| `DATABASE_URL` | (Postgres reference — Addım 3) |
| `NEXTAUTH_SECRET` | öz uzun gizli açarın |
| `ADMIN_USER` | `admin` |
| `ADMIN_PASSWORD` | **YENİ güclü parol qoy** (köhnəni dəyiş!) |
| `ANTHROPIC_API_KEY` | `sk-ant-...` |
| `SMTP_HOST` | `smtp.ionos.de` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | `info@mz-personalvermittlung.de` |
| `SMTP_PASS` | IONOS mail parolu |
| `SMTP_FROM` | `info@mz-personalvermittlung.de` |
| `AGENCY_NAME` | `MZ Personalvermittlung` |
| `AGENCY_PHONE` | telefon |
| `AGENCY_CONTACT_EMAIL` | `info@mz-personalvermittlung.de` |
| `AGENCY_WEBSITE` | `https://mz-personalvermittlung.de` |
| `ADZUNA_APP_ID` | `9c03aaa5` |
| `ADZUNA_APP_KEY` | açar |
| `MAX_OUTREACH_PER_DAY` | `20` |
| `OUTREACH_COOLDOWN_DAYS` | `30` |
| `OUTREACH_TEST_RECIPIENT` | **BOŞ qoy** (real göndəriş üçün) |
| `PUPPETEER_EXECUTABLE_PATH` | `/usr/bin/chromium` |
| `PUPPETEER_SKIP_DOWNLOAD` | `true` |

> Dəyişənləri yazandan sonra Railway servisi avtomatik yenidən deploy edir.

---

## 5. Saytı yoxla

1. App servisi → **Settings** → **Networking** → **Generate Domain**.
2. Yaranan `https://mz-talent-production-xxxx.up.railway.app` ünvanını aç.
3. `/login` → `admin` + yeni parol ilə gir.
4. `/api/health` aç — `{"status":"ok","db":"up"}` görsənməlidir.

---

## 6. Öz domeninə bağla (`app.mz-personalvermittlung.de`)

1. Railway → App servisi → **Settings** → **Networking** → **Custom Domain** →
   `app.mz-personalvermittlung.de` yaz.
2. Railway sənə bir **CNAME hədəfi** verəcək (məs. `xxxx.up.railway.app`).
3. **IONOS** → Domains → `mz-personalvermittlung.de` → **DNS** → **Record əlavə et**:
   - Type: `CNAME`
   - Host/Name: `app`
   - Points to / Value: (Railway-in verdiyi hədəf)
   - TTL: default
4. 10–30 dəqiqəyə DNS yayılır, Railway avtomatik HTTPS sertifikatı verir.

> Əsas domen (`mz-personalvermittlung.de`) və mail IONOS-da qalır — heç nə dəyişmir.
> Yalnız yeni `app.` alt-domeni Railway-ə işarə edir.

---

## ⚠️ Canlıya çıxmazdan əvvəl (təhlükəsizlik)
- [ ] `ADMIN_PASSWORD` — yeni güclü parol
- [ ] `OUTREACH_TEST_RECIPIENT` — **boş** (yoxsa bütün məktublar test ünvanına gedir)
- [ ] Anthropic / IONOS SMTP / Adzuna açarları açıq qaldıqları üçün **yenilərini al** (rotate)
- [ ] IONOS-da DKIM aktiv et (mail spam-a düşməsin)
