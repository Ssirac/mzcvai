import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { anthropic, extractText } from "@/lib/anthropic";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LANG_NAMES: Record<string, string> = {
  az: "Azerbaijani",
  de: "German",
  en: "English",
};

// A reply's text never changes, so one paid translation per (message, language)
// for the lifetime of the process is enough. Bounded so it can't grow forever.
const cache = new Map<string, string>();
const CACHE_MAX = 500;

// POST /api/inbox/[id]/translate — translate an employer's reply into the UI
// language, so the user can read German mails without leaving the app.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const body = await req.json().catch(() => ({}));
    const lang = LANG_NAMES[String(body.lang)] ? String(body.lang) : "az";

    const outreach = await prisma.outreach.findUnique({
      where: { id: params.id },
      select: { replyText: true },
    });
    if (!outreach) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const text = (outreach.replyText ?? "").trim();
    if (!text) return NextResponse.json({ error: "No text to translate" }, { status: 400 });

    const key = `${params.id}:${lang}`;
    const hit = cache.get(key);
    if (hit) return NextResponse.json({ ok: true, lang, text: hit, cached: true });

    const msg = await anthropic.messages.create({
      model: process.env.TRANSLATE_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      system:
        `Translate the email the user sends you into ${LANG_NAMES[lang]}. ` +
        "Preserve line breaks and paragraph structure. Keep names, company names, " +
        "URLs, email addresses, dates and times unchanged. Output ONLY the " +
        "translation — no preamble, no notes, no quotes around it.",
      messages: [{ role: "user", content: text.slice(0, 20_000) }],
    });
    const translated = extractText(msg);
    if (!translated) {
      return NextResponse.json({ error: "Empty translation" }, { status: 502 });
    }

    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(key, translated);

    return NextResponse.json({ ok: true, lang, text: translated });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
