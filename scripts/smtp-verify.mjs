// SMTP connection + auth verification only (no email sent). Tries 587 and 465.
import "dotenv/config";
import nodemailer from "nodemailer";

const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
console.log(`User: ${user}`);
console.log(`Pass length: ${pass ? pass.length : 0} chars`);

const configs = [
  { host: "smtp.ionos.de", port: 587, secure: false, label: "587 STARTTLS" },
  { host: "smtp.ionos.de", port: 465, secure: true, label: "465 SSL" },
  { host: "smtp.ionos.com", port: 587, secure: false, label: "587 .com STARTTLS" },
];

for (const c of configs) {
  const t = nodemailer.createTransport({
    host: c.host, port: c.port, secure: c.secure,
    auth: { user, pass },
    connectionTimeout: 15000,
  });
  process.stdout.write(`[${c.label}] ${c.host}:${c.port} ... `);
  try {
    await t.verify();
    console.log("OK ✓ (login succeeded)");
  } catch (err) {
    console.log("FAILED — " + err.message);
  }
}
