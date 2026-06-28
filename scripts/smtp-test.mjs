// Send one test email via the configured IONOS SMTP.
// Usage: node scripts/smtp-test.mjs <recipient>
import "dotenv/config";
import nodemailer from "nodemailer";

const to = process.argv[2] || process.env.SMTP_USER;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT ?? "587"),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

console.log(`From: ${process.env.SMTP_FROM}`);
console.log(`To:   ${to}`);

await transporter.verify();
console.log("✓ SMTP auth OK");

const info = await transporter.sendMail({
  from: process.env.SMTP_FROM,
  to,
  subject: "MZ Personalvermittlung — Test (Sirac Cavadoff)",
  text:
    "Salam,\n\nBu, MZ Talent Intelligence panelindən göndərilən avtomatik sınaq mailidir.\n" +
    "Namizəd Sirac Cavadoff üçün mail sistemi yoxlanılır. SMTP düzgün konfiqurasiya olunub.\n\n" +
    "Hörmətlə,\nMZ Personalvermittlung",
  html:
    "<p>Salam,</p><p>Bu, <b>MZ Talent Intelligence</b> panelindən göndərilən avtomatik sınaq mailidir. " +
    "Namizəd <b>Sirac Cavadoff</b> üçün mail sistemi yoxlanılır. SMTP düzgün konfiqurasiya olunub.</p>" +
    "<p>Hörmətlə,<br>MZ Personalvermittlung</p>",
});

console.log("✓ Sent. messageId:", info.messageId);
console.log("  accepted:", info.accepted);
console.log("  rejected:", info.rejected);
console.log("  response:", info.response);
