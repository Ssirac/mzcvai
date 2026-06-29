import { NextResponse } from "next/server";
import { launchBrowser } from "@/lib/browser";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/browser-test
// Checks whether headless Chromium actually launches in this environment. Email
// discovery via website (Impressum) scraping depends on it, so this isolates
// whether that half of enrichment works on the server.
export async function GET() {
  const execPath = process.env.PUPPETEER_EXECUTABLE_PATH || "(bundled)";
  try {
    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 20000 });
    const title = await page.title();
    await browser.close();
    return NextResponse.json({ ok: true, execPath, title });
  } catch (err) {
    return NextResponse.json(
      { ok: false, execPath, error: (err as Error).message },
      { status: 500 }
    );
  }
}
