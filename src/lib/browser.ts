import puppeteer, { type Browser } from "puppeteer";

/**
 * Launch a headless Chromium. On a server (Docker/Railway) we use the system
 * Chromium via PUPPETEER_EXECUTABLE_PATH; locally Puppeteer's bundled browser
 * is used. Shared by enrichment (website scraping) and CV-PDF generation.
 */
export function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
}
