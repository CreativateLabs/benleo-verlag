/**
 * Transactional mail via IONOS SMTP (post@benleo-verlag.de).
 * If SMTP env vars are absent (not configured yet), it no-ops gracefully —
 * submissions are still stored and visible in the admin inbox.
 */
const nodemailer = require('nodemailer');

const HOST = process.env.SMTP_HOST;
const PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;
const NOTIFY = process.env.NOTIFY_EMAIL || 'post@benleo-verlag.de';
const FROM = process.env.FROM_EMAIL || USER || 'post@benleo-verlag.de';

let transport = null;
if (HOST && USER && PASS) {
  transport = nodemailer.createTransport({ host: HOST, port: PORT, secure: PORT === 465, auth: { user: USER, pass: PASS } });
}

async function sendSubmissionMail(sub) {
  if (!transport) { console.log('[mailer] SMTP not configured — skipping notification for', sub.id); return; }
  const text = [
    `Neue Einreichung — ${sub.category}`, '',
    `Name:    ${sub.name}`, `E-Mail:  ${sub.email}`, `Betreff: ${sub.subject || '—'}`, '',
    'Nachricht:', sub.message || '—', '',
    sub.fileName ? `Datei: ${sub.fileName} (${Math.round((sub.fileSize || 0) / 1024)} KB)` : 'Datei: keine',
    '', `Eingegangen: ${sub.createdAt}`,
  ].join('\n');
  await transport.sendMail({ from: FROM, to: NOTIFY, replyTo: sub.email, subject: `[Benleo] Neue Einreichung: ${sub.category} — ${sub.subject || sub.name}`, text });
  console.log('[mailer] sent submission notification to', NOTIFY);
}
module.exports = { sendSubmissionMail };
