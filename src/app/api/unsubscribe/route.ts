import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/unsubscribe?id=<employerId>
// Public opt-out link placed in every outreach footer (UWG / GDPR). Clicking it
// flags the employer as opted-out so no further emails are sent. Returns a small
// HTML confirmation page in German.
function page(title: string, body: string): Response {
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{max-width:440px;padding:32px;background:#171717;border:1px solid #262626;border-radius:16px;text-align:center}
h1{font-size:18px;margin:0 0 8px}p{color:#a3a3a3;font-size:14px;line-height:1.5;margin:0}</style>
</head><body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return page("Ungültiger Link", "Dieser Abmeldelink ist nicht gültig.");
  }
  try {
    await prisma.employer.update({ where: { id }, data: { optedOut: true } });
    return page(
      "Sie wurden abgemeldet",
      "Sie erhalten keine weiteren Nachrichten von MZ Personalvermittlung. Vielen Dank."
    );
  } catch {
    return page(
      "Abmeldung notiert",
      "Falls Sie weiterhin Nachrichten erhalten, antworten Sie bitte mit „STOP“."
    );
  }
}
