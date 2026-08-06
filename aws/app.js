/**
 * BENLEO VERLAG — API (Express, runs in Lambda via serverless-http).
 * Same HTTP contract as the local demo, backed by DynamoDB + S3.
 * Large uploads use S3 presigned PUT (browser → S3, up to 200 MB) —
 * file bytes never pass through Lambda.
 */
const crypto = require('crypto');
const express = require('express');
const cors = null; // CORS handled at API Gateway; keep bundle small
const bcrypt = require('bcryptjs');

const store = require('./store');
const s3 = require('./s3');
const plugins = require('./plugins');
const { sign, attachUser, requireAuth, requireAdmin } = require('./auth');
const { sendSubmissionMail, sendNewsletterConfirm } = require('./mailer');

function confirmPage(ok) {
  const msg = ok
    ? { h: '✓ Anmeldung bestätigt', p: 'Danke! Du erhältst ab sofort unsere Neuigkeiten.' }
    : { h: 'Link ungültig oder abgelaufen', p: 'Bitte melde dich ggf. erneut an.' };
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Newsletter — BENLEO VERLAG</title><style>body{margin:0;font-family:Arial,sans-serif;background:#1a2257;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center}
    .c{max-width:440px;text-align:center;padding:2.5rem}.c h1{color:#F9D386;font-weight:400}.c a{color:#F9D386}</style></head>
    <body><div class="c"><h1>${msg.h}</h1><p>${msg.p}</p><p><a href="/">← Zur Website</a></p></div></body></html>`;
}

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role });
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch(e => { console.error(e); res.status(500).json({ error: 'Serverfehler' }); });

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(attachUser);

app.get('/api/health', (_req, res) => res.json({ ok: true, time: now(), backend: 'aws' }));

/* ---------- AUTH ---------- */
app.post('/api/auth/register', wrap(async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'E-Mail und Passwort erforderlich' });
  if (await store.getUserByEmail(email)) return res.status(409).json({ error: 'E-Mail bereits registriert' });
  const user = { id: uid(), email: String(email).toLowerCase(), name: name || '', role: 'user', passwordHash: bcrypt.hashSync(String(password), 10), createdAt: now() };
  await store.createUser(user);
  res.status(201).json({ token: sign(user), user: publicUser(user) });
}));
app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const user = await store.getUserByEmail(email || '');
  if (!user || !bcrypt.compareSync(String(password || ''), user.passwordHash)) return res.status(401).json({ error: 'E-Mail oder Passwort falsch' });
  res.json({ token: sign(user), user: publicUser(user) });
}));
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

/* ---------- CONTENT (CMS) ---------- */
app.get('/api/content', wrap(async (_req, res) => res.json(await store.getContentAll())));
app.put('/api/content/:key', requireAdmin, wrap(async (req, res) => {
  const { de, en } = req.body || {};
  res.json({ key: req.params.key, value: await store.putContentText(req.params.key, de, en) });
}));
app.post('/api/content/register', wrap(async (req, res) => {
  const fields = Array.isArray((req.body || {}).fields) ? req.body.fields : [];
  res.json({ ok: true, registered: await store.registerMeta(fields) });
}));
app.get('/api/admin/content-fields', requireAdmin, wrap(async (_req, res) => res.json(await store.getMetaAll())));
app.post('/api/content/:key/image', requireAdmin, wrap(async (req, res) => {
  const fileKey = (req.body || {}).fileKey;
  if (!fileKey) return res.status(400).json({ error: 'fileKey fehlt' });
  res.json({ key: req.params.key, value: await store.putContentImage(req.params.key, '/api/media/' + fileKey) });
}));

/* ---------- PRODUCTS ---------- */
app.get('/api/products', wrap(async (_req, res) => res.json(await store.listProducts())));
app.post('/api/products', requireAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const list = await store.listProducts();
  const p = { id: uid(), slug: b.slug || '', type: b.type || 'roman', title: b.title || { de: '', en: '' }, author: b.author || '', status: b.status || 'published', blurName: !!b.blurName, description: b.description || { de: '', en: '' }, coverKey: b.coverKey || null, amazonUrl: b.amazonUrl || '', order: b.order || (list.length + 1), createdAt: now() };
  res.status(201).json(await store.createProduct(p));
}));
app.put('/api/products/:id', requireAdmin, wrap(async (req, res) => {
  const p = await store.updateProduct(req.params.id, { ...(req.body || {}), id: req.params.id });
  if (!p) return res.status(404).json({ error: 'Produkt nicht gefunden' });
  res.json(p);
}));
app.delete('/api/products/:id', requireAdmin, wrap(async (req, res) => { await store.deleteProduct(req.params.id); res.json({ ok: true }); }));

/* ---------- EVENTS ---------- */
app.get('/api/events', wrap(async (_req, res) => res.json(await store.listEvents())));
app.post('/api/events', requireAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const list = await store.listEvents();
  const e = { id: uid(), slug: b.slug || '', kind: b.kind || 'veranstaltung', title: b.title || { de: '', en: '' }, description: b.description || { de: '', en: '' }, location: b.location || '', status: b.status || 'published', date: b.date || '', order: b.order || (list.length + 1), createdAt: now() };
  res.status(201).json(await store.createEvent(e));
}));
app.put('/api/events/:id', requireAdmin, wrap(async (req, res) => {
  const e = await store.updateEvent(req.params.id, { ...(req.body || {}), id: req.params.id });
  if (!e) return res.status(404).json({ error: 'Event nicht gefunden' });
  res.json(e);
}));
app.delete('/api/events/:id', requireAdmin, wrap(async (req, res) => { await store.deleteEvent(req.params.id); res.json({ ok: true }); }));

/* ---------- UPLOADS (presigned PUT) ---------- */
app.post('/api/uploads/presign', wrap(async (req, res) => {
  const { filename, contentType, kind } = req.body || {};
  const key = s3.makeKey(kind === 'content' ? 'content' : 'submissions', filename);
  res.json({ url: await s3.presignPut(key, contentType), key });
}));

/* ---------- SUBMISSIONS ---------- */
app.post('/api/submissions', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.email || !b.category) return res.status(400).json({ error: 'Name, E-Mail und Kategorie erforderlich' });
  const sub = { id: uid(), userId: req.user ? req.user.id : null, name: b.name, email: b.email, category: b.category, subject: b.subject || '', message: b.message || '', fileKey: b.fileKey || null, fileName: b.fileName || null, fileSize: b.fileSize || 0, status: 'neu', createdAt: now() };
  await store.createSubmission(sub);
  try { await sendSubmissionMail(sub); } catch (e) { console.error('[mail]', e.message); }
  res.status(201).json({ ok: true, id: sub.id });
}));
app.get('/api/submissions', requireAdmin, wrap(async (_req, res) => res.json(await store.listSubmissions())));
app.get('/api/submissions/mine', requireAuth, wrap(async (req, res) => res.json(await store.listSubmissionsByUser(req.user.id))));
app.put('/api/submissions/:id', requireAdmin, wrap(async (req, res) => {
  const s = await store.updateSubmission(req.params.id, typeof (req.body || {}).status === 'string' ? { status: req.body.status } : {});
  if (!s) return res.status(404).json({ error: 'Einreichung nicht gefunden' });
  res.json(s);
}));

/* ---------- FILE ACCESS ---------- */
app.get('/api/files/*', requireAuth, wrap(async (req, res) => {
  const key = req.params[0];
  const ownerId = await store.getFileOwner(key);
  if (req.user.role !== 'admin' && ownerId !== req.user.id) return res.status(403).json({ error: 'Kein Zugriff' });
  res.redirect(302, await s3.presignGet(key));
}));
app.get('/api/media/*', wrap(async (req, res) => { res.redirect(302, await s3.presignGet(req.params[0])); }));

/* ---------- PLUGINS ---------- */
app.get('/api/plugins', wrap(async (_req, res) => res.json(plugins.publicView(await store.getPluginsState()))));
app.get('/api/admin/plugins', requireAdmin, wrap(async (_req, res) => res.json(plugins.adminView(await store.getPluginsState()))));
app.put('/api/plugins/:id', requireAdmin, wrap(async (req, res) => {
  if (!plugins.BY_ID[req.params.id]) return res.status(404).json({ error: 'Plugin unbekannt' });
  const state = plugins.normalize(await store.getPluginsState());
  const cur = state[req.params.id];
  if (typeof (req.body || {}).enabled === 'boolean') cur.enabled = req.body.enabled;
  if (req.body && req.body.settings) cur.settings = Object.assign(cur.settings, req.body.settings);
  await store.putPluginsState(state);
  res.json({ id: req.params.id, enabled: cur.enabled, settings: cur.settings });
}));
app.post('/api/plugins/newsletter/subscribe', wrap(async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Bitte gültige E-Mail angeben' });
  const existing = await store.getSubscriber(email);
  if (existing && existing.status === 'confirmed') return res.json({ ok: true, already: true });
  const token = crypto.randomUUID().replace(/-/g, '');
  await store.addSubscriber(email, now(), token);
  const url = (process.env.SITE_URL || '') + '/api/plugins/newsletter/confirm?token=' + token;
  try { await sendNewsletterConfirm(email, url); } catch (e) { console.error('[mail]', e.message); }
  res.status(201).json({ ok: true, pending: true });
}));
app.get('/api/plugins/newsletter/confirm', wrap(async (req, res) => {
  const token = String(req.query.token || '');
  const email = token ? await store.confirmSubscriberByToken(token) : null;
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(confirmPage(!!email));
}));
app.get('/api/plugins/newsletter/subscribers', requireAdmin, wrap(async (_req, res) => res.json(await store.listSubscribers())));

module.exports = app;
