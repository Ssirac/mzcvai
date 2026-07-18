import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Public opt-out link placed in every outreach footer (UWG / GDPR).
// GET shows a one-button confirmation page; the actual opt-out happens on POST.
// Why not opt-out directly on GET: corporate mail scanners / link-preview bots
// follow every link in an email — a GET that mutates state produced accidental
// opt-outs for employers who never clicked anything. Bots don't submit forms.
function page(title: string, body: string, formAction?: string): Response {
  const form = formAction
    ? `<form method="post" action="${formAction}" style="margin-top:16px">
<button type="submit" style="background:#dc2626;color:#fff;border:0;border-radius:10px;padding:10px 22px;font-size:14px;font-weight:600;cursor:pointer">Abmeldung bestätigen</button>
</form>`
    : "";
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{max-width:440px;padding:32px;background:#171717;border:1px solid #262626;border-radius:16px;text-align:center}
h1{font-size:18px;margin:0 0 8px}p{color:#a3a3a3;font-size:14px;line-height:1.5;margin:0}</style>
</head><body><div class="card"><h1>${title}</h1><p>${body}</p>${form}</div></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// Employer ids are cuids — never HTML/attribute-significant characters. Guard
// anyway so nothing attacker-shaped is ever echoed into the form action.
const SAFE_ID = /^[a-z0-9]{10,40}$/i;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !SAFE_ID.test(id)) {
    return page("Ungültiger Link", "Dieser Abmeldelink ist nicht gültig.");
  }
  return page(
    "Abmeldung bestätigen",
    "Möchten Sie keine weiteren Nachrichten von MZ Talent Solutions erhalten? Bitte bestätigen Sie mit einem Klick.",
    `/api/unsubscribe?id=${id}`
  );
}

export async function POST(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !SAFE_ID.test(id)) {
    return page("Ungültiger Link", "Dieser Abmeldelink ist nicht gültig.");
  }
  try {
    await prisma.employer.update({ where: { id }, data: { optedOut: true } });
    return page(
      "Sie wurden abgemeldet",
      "Sie erhalten keine weiteren Nachrichten von MZ Talent Solutions. Vielen Dank."
    );
  } catch {
    return page(
      "Abmeldung notiert",
      "Falls Sie weiterhin Nachrichten erhalten, antworten Sie bitte mit „STOP“."
    );
  }
}
