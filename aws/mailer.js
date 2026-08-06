/**
 * Transactional mail via IONOS SMTP (post@benleo-verlag.de).
 * Host/port/user come from env; the PASSWORD is read at runtime from
 * AWS SSM Parameter Store (SecureString) — never in code, env or git.
 * If nothing is configured yet, it no-ops gracefully (submissions still
 * land in the admin inbox).
 */
const nodemailer = require('nodemailer');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm'); // provided by Lambda runtime

const HOST = process.env.SMTP_HOST;
const PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const USER = process.env.SMTP_USER;
const PASS_ENV = process.env.SMTP_PASS;                 // optional direct (local/dev)
const PASS_PARAM = process.env.SMTP_PASS_PARAM;         // SSM SecureString name (prod)
const NOTIFY = process.env.NOTIFY_EMAIL || 'post@benleo-verlag.de';
const FROM = process.env.FROM_EMAIL || USER || 'post@benleo-verlag.de';

let transportPromise = null;
async function getTransport() {
  if (transportPromise) return transportPromise;
  if (!HOST || !USER) return null;
  transportPromise = (async () => {
    let pass = PASS_ENV;
    if (!pass && PASS_PARAM) {
      const ssm = new SSMClient({});
      const r = await ssm.send(new GetParameterCommand({ Name: PASS_PARAM, WithDecryption: true }));
      pass = r.Parameter && r.Parameter.Value;
    }
    if (!pass) throw new Error('SMTP-Passwort nicht gesetzt');
    return nodemailer.createTransport({ host: HOST, port: PORT, secure: PORT === 465, auth: { user: USER, pass } });
  })().catch(e => { transportPromise = null; throw e; }); // don't cache failures
  return transportPromise;
}

async function sendSubmissionMail(sub) {
  let transport;
  try { transport = await getTransport(); }
  catch (e) { console.log('[mailer] noch nicht sendebereit:', e.message); return; }
  if (!transport) { console.log('[mailer] SMTP nicht konfiguriert — übersprungen für', sub.id); return; }
  const text = [
    `Neue Einreichung — ${sub.category}`, '',
    `Name:    ${sub.name}`, `E-Mail:  ${sub.email}`, `Betreff: ${sub.subject || '—'}`, '',
    'Nachricht:', sub.message || '—', '',
    sub.fileName ? `Datei: ${sub.fileName} (${Math.round((sub.fileSize || 0) / 1024)} KB)` : 'Datei: keine',
    '', `Eingegangen: ${sub.createdAt}`,
  ].join('\n');
  await transport.sendMail({ from: FROM, to: NOTIFY, replyTo: sub.email, subject: `[Benleo] Neue Einreichung: ${sub.category} — ${sub.subject || sub.name}`, text });
  console.log('[mailer] Benachrichtigung gesendet an', NOTIFY);
}

// Newsletter double opt-in confirmation (sent to the subscriber).
async function sendNewsletterConfirm(email, confirmUrl) {
  let transport;
  try { transport = await getTransport(); } catch (e) { console.log('[mailer] confirm übersprungen:', e.message); return; }
  if (!transport) { console.log('[mailer] SMTP nicht konfiguriert — confirm übersprungen'); return; }
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1a2257">
    <p>Danke für dein Interesse am <strong>BENLEO VERLAG</strong>!</p>
    <p>Bitte bestätige deine Newsletter-Anmeldung mit einem Klick:</p>
    <p><a href="${confirmUrl}" style="display:inline-block;background:#C9A84C;color:#1a2257;padding:12px 22px;border-radius:4px;text-decoration:none;font-weight:bold">Anmeldung bestätigen</a></p>
    <p style="color:#777;font-size:13px">Wenn du das nicht warst, ignoriere diese E-Mail einfach — es passiert dann nichts.</p>
  </div>`;
  await transport.sendMail({ from: FROM, to: email, subject: 'Bitte bestätige deine Newsletter-Anmeldung — BENLEO VERLAG', html, text: 'Bitte bestätige deine Anmeldung: ' + confirmUrl });
  console.log('[mailer] Double-Opt-In-Mail gesendet an', email);
}

module.exports = { sendSubmissionMail, sendNewsletterConfirm };
