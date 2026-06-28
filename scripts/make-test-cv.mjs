// Generate a sample CV PDF for testing the parse-cv endpoint.
import puppeteer from "puppeteer";
import fs from "fs";

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:Arial;padding:40px;color:#111;font-size:14px;line-height:1.5}
h1{margin:0}h2{border-bottom:1px solid #ccc;margin-top:24px}</style></head><body>
<h1>Elvin Məmmədov</h1>
<p>E-Mail: elvin.mammadov@gmail.com · Tel: +994 50 123 45 67<br>
Geburtsdatum: 12.05.1994 · Staatsangehörigkeit: Aserbaidschan · Familienstand: ledig<br>
Adresse: Nizami küç. 10, Baku, Aserbaidschan</p>

<h2>Berufsziel</h2>
<p>Koch (Küchenchef) in einem Hotel in Deutschland. Gehaltsvorstellung: 2800€ brutto. Führerschein: B.</p>

<h2>Berufserfahrung</h2>
<p><b>Koch</b>, Hilton Baku, 2019–2024<br>Zubereitung internationaler Gerichte, Teamleitung von 5 Personen.</p>
<p><b>Beikoch</b>, Restaurant Sahil, 2016–2019<br>Vorbereitung, Salate, Desserts.</p>

<h2>Ausbildung</h2>
<p><b>Diplom Gastronomie</b>, Baku Culinary College, 2013–2016</p>

<h2>Sprachen</h2>
<p>Aserbaidschanisch (Muttersprache), Englisch, Russisch, Deutsch B1</p>

<h2>Fähigkeiten & Zertifikate</h2>
<p>HACCP, Grillstation, Menüplanung. Zertifikat: Goethe B1, HACCP-Schulung.</p>
</body></html>`;

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "networkidle0" });
const out = "C:/Users/LOQ/AppData/Local/Temp/claude/C--Users-LOQ-Desktop-mzaicv/a8205b8a-aedb-474b-bbd9-56d2874c5b18/scratchpad/test-cv.pdf";
await page.pdf({ path: out, format: "A4" });
await browser.close();
console.log("PDF written:", out, fs.statSync(out).size, "bytes");
