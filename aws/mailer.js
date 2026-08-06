/**
 * Transactional mail via IONOS SMTP (post@benleo-verlag.de).
 * Host/port/user come from env; the PASSWORD is read at runtime from
 * AWS SSM Parameter Store (SecureString) — never in code, env or git.
 * If nothing is configured yet, it no-ops gracefully (submissions still
 * land in the admin inbox).
 */
const nodemailer = require('nodemailer');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm'); // provided by Lambda runtime
const store = require('./store');

// Editable email templates: admin override (Inhalte -> E-Mails) or built-in default.
const MAIL_DEFAULTS = Object.fromEntries((store.MAIL_FIELDS || []).map(f => [f.key, f.default.de]));
async function tpl(key) {
  try { const c = await store.getContentAll(); if (c[key] && c[key].de) return c[key].de; } catch (e) {}
  return MAIL_DEFAULTS[key] || '';
}
const escc = s => String(s == null ? '' : s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const htmlBody = s => escc(s).replace(/\n/g, '<br>');
const wrapHtml = inner => `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1a2257;line-height:1.6">${inner}<p style="color:#888;font-size:12px;margin-top:1.5rem">BENLEO VERLAG</p></div>`;

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

// Step 1 of double opt-in: GDPR confirmation with a link (sent FIRST for any
// first-time email — newsletter, account, submission).
async function sendConfirm(email, link) {
  let transport; try { transport = await getTransport(); } catch (e) { console.log('[mailer] confirm übersprungen:', e.message); return; }
  if (!transport) { console.log('[mailer] SMTP nicht konfiguriert — confirm übersprungen'); return; }
  const body = await tpl('mail.confirm.body'); const btn = await tpl('mail.confirm.button');
  const html = wrapHtml(`<p>${htmlBody(body)}</p>
    <p><a href="${link}" style="display:inline-block;background:#C9A84C;color:#1a2257;padding:12px 22px;border-radius:4px;text-decoration:none;font-weight:bold">${escc(btn)}</a></p>
    <p style="color:#888;font-size:12px">Wenn du das nicht warst, ignoriere diese E-Mail einfach.</p>`);
  await transport.sendMail({ from: FROM, to: email, subject: 'Bitte bestätige deine E-Mail — BENLEO VERLAG', html, text: body + '\n\n' + link });
  console.log('[mailer] Bestätigungs-Mail (Double-Opt-In) an', email);
}

// Step 2 emails (sent AFTER confirmation):
async function sendWelcome(email, name) {
  let transport; try { transport = await getTransport(); } catch (e) { return; }
  if (!transport) return;
  const body = (await tpl('mail.welcome.body')).replace(/\{\{name\}\}/g, name || '');
  await transport.sendMail({ from: FROM, to: email, subject: 'Willkommen beim BENLEO VERLAG', html: wrapHtml(`<p>${htmlBody(body)}</p>`), text: body });
  console.log('[mailer] Willkommens-Mail an', email);
}
async function sendSubmissionAck(sub) {
  let transport; try { transport = await getTransport(); } catch (e) { return; }
  if (!transport) return;
  const body = (await tpl('mail.ack.body')).replace(/\{\{name\}\}/g, sub.name || '');
  await transport.sendMail({ from: FROM, to: sub.email, replyTo: NOTIFY, subject: 'Danke für deine Einreichung — BENLEO VERLAG', html: wrapHtml(`<p>${htmlBody(body)}</p>`), text: body });
  console.log('[mailer] Einreichungs-Bestätigung an', sub.email);
}
async function sendNewsletterWelcome(email) {
  let transport; try { transport = await getTransport(); } catch (e) { return; }
  if (!transport) return;
  const body = await tpl('mail.newsletter.body');
  await transport.sendMail({ from: FROM, to: email, subject: 'Newsletter bestätigt — BENLEO VERLAG', html: wrapHtml(`<p>${htmlBody(body)}</p>`), text: body });
  console.log('[mailer] Newsletter-Willkommen an', email);
}

module.exports = { sendSubmissionMail, sendConfirm, sendSubmissionAck, sendWelcome, sendNewsletterWelcome };
