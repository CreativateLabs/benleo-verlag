/**
 * Mailer — dev transport that logs mails to console + a local outbox file.
 * Mirrors AWS SES. To go live, swap the transport for SES (env-driven) and
 * verify benleo-verlag.de; the sendSubmissionMail() interface stays identical.
 */
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'post@benleo-verlag.de';
const FROM_EMAIL = process.env.FROM_EMAIL || 'no-reply@benleo-verlag.de';
const OUTBOX = path.join(__dirname, 'data', 'outbox.json');

// jsonTransport => never actually sends; returns the composed message.
const transport = nodemailer.createTransport({ jsonTransport: true });

function appendOutbox(entry) {
  let list = [];
  try { if (fs.existsSync(OUTBOX)) list = JSON.parse(fs.readFileSync(OUTBOX, 'utf8')); } catch (e) {}
  list.push(entry);
  try { fs.writeFileSync(OUTBOX, JSON.stringify(list, null, 2)); } catch (e) {}
}

async function sendSubmissionMail(sub) {
  const lines = [
    `Neue Einreichung — ${sub.category}`,
    '',
    `Name:    ${sub.name}`,
    `E-Mail:  ${sub.email}`,
    `Kategorie: ${sub.category}`,
    `Betreff: ${sub.subject || '—'}`,
    '',
    'Nachricht:',
    sub.message || '—',
    '',
    sub.fileName ? `Datei: ${sub.fileName} (${Math.round((sub.fileSize || 0) / 1024)} KB)` : 'Datei: keine',
    '',
    `Eingegangen: ${sub.createdAt}`,
  ];
  const msg = {
    from: FROM_EMAIL,
    to: NOTIFY_EMAIL,
    replyTo: sub.email,
    subject: `[Benleo] Neue Einreichung: ${sub.category} — ${sub.subject || sub.name}`,
    text: lines.join('\n'),
  };
  const info = await transport.sendMail(msg);
  appendOutbox({ at: new Date().toISOString(), to: NOTIFY_EMAIL, subject: msg.subject });
  console.log(`[mailer] (dev) Einreichungs-Mail an ${NOTIFY_EMAIL} — ${msg.subject}`);
  return info;
}

module.exports = { sendSubmissionMail, NOTIFY_EMAIL };
