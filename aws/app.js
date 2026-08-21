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
const { sendSubmissionMail, sendConfirm, sendSubmissionAck, sendWelcome, sendNewsletterWelcome } = require('./mailer');
const confirmUrl = (token) => (process.env.SITE_URL || '') + '/api/confirm?token=' + token;
const newToken = () => crypto.randomUUID().replace(/-/g, '');

function confirmPage(ok) {
  const msg = ok
    ? { h: '✓ E-Mail bestätigt', p: 'Vielen Dank! Deine E-Mail-Adresse ist bestätigt.' }
    : { h: 'Link ungültig oder abgelaufen', p: 'Bitte fordere ggf. eine neue Bestätigung an.' };
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
  // If this email already submitted something (before creating a profile), attach
  // those submissions to the new account so they show up under "Meine Einreichungen".
  let linked = 0;
  try { linked = await store.linkSubmissionsByEmail(user.email, user.id); } catch (e) { console.error('[link]', e.message); }
  if (linked) console.log('[link] ' + linked + ' Einreichung(en) mit neuem Profil verknüpft:', user.email);
  let pending = false;
  if (await store.isEmailConfirmed(user.email)) {
    try { await sendWelcome(user.email, user.name); } catch (e) { console.error('[mail]', e.message); }
  } else {
    pending = true;
    const token = newToken();
    await store.createPending(token, { email: user.email, type: 'account', name: user.name });
    try { await sendConfirm(user.email, confirmUrl(token)); } catch (e) { console.error('[mail]', e.message); }
  }
  res.status(201).json({ token: sign(user), user: publicUser(user), pending });
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

/* ---------- CATEGORIES (Bildende Kunst / Literatur / Musik) ---------- */
app.get('/api/categories', wrap(async (_req, res) => res.json(await store.listCategories())));
app.post('/api/categories', requireAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const key = String(b.key || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!key) return res.status(400).json({ error: 'Schlüssel (key) erforderlich' });
  const list = await store.listCategories();
  const c = { key, name: b.name || { de: '', en: '' }, intro: b.intro || { de: '', en: '' }, heroImageKey: b.heroImageKey || null, order: b.order || (list.length + 1) };
  res.status(201).json(await store.upsertCategory(c));
}));
app.put('/api/categories/:key', requireAdmin, wrap(async (req, res) => {
  const cur = await store.getCategory(req.params.key);
  if (!cur) return res.status(404).json({ error: 'Kategorie nicht gefunden' });
  res.json(await store.upsertCategory({ ...cur, ...(req.body || {}), key: req.params.key }));
}));
app.delete('/api/categories/:key', requireAdmin, wrap(async (req, res) => { await store.deleteCategory(req.params.key); res.json({ ok: true }); }));

/* ---------- PRODUCTS ---------- */
// Rich, category-specific blocks (all optional): gallery (Kunst), audio (Musik),
// samplePages (Literatur reading sample), artist profile.
const _bi = (o) => ({ de: (o && o.de) || '', en: (o && o.en) || '' });
const normGallery = (arr) => (Array.isArray(arr) ? arr : []).map(g => ({ imageKey: g.imageKey || null, caption: g.caption || '' })).filter(g => g.imageKey);
const normAudio = (arr) => (Array.isArray(arr) ? arr : []).map(a => ({ label: a.label || '', audioKey: a.audioKey || null, audioUrl: a.audioKey ? '' : (a.audioUrl || '') })).filter(a => a.audioKey || String(a.audioUrl).trim());
const normPages = (arr) => (Array.isArray(arr) ? arr : []).map(p => (typeof p === 'string' ? p : (p && p.imageKey))).filter(Boolean);
const normArtist = (a) => ({ name: (a && a.name) || '', photoKey: (a && a.photoKey) || null, bio: _bi(a && a.bio) });
app.get('/api/products', wrap(async (_req, res) => res.json(await store.listProducts())));
app.get('/api/products/:id', wrap(async (req, res) => {
  const p = await store.getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'Produkt nicht gefunden' });
  res.json(p);
}));
app.post('/api/products', requireAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const list = await store.listProducts();
  const p = {
    id: uid(), slug: b.slug || '', type: b.type || 'roman', title: b.title || { de: '', en: '' }, author: b.author || '', status: b.status || 'published', blurName: !!b.blurName, description: b.description || { de: '', en: '' }, coverKey: b.coverKey || null, amazonUrl: b.amazonUrl || '', order: b.order || (list.length + 1), createdAt: now(),
    category: b.category || '', shortInfo: b.shortInfo || { de: '', en: '' }, bodyText: b.bodyText || { de: '', en: '' },
    artist: normArtist(b.artist), gallery: normGallery(b.gallery), audio: normAudio(b.audio), samplePages: normPages(b.samplePages),
  };
  res.status(201).json(await store.createProduct(p));
}));
app.put('/api/products/:id', requireAdmin, wrap(async (req, res) => {
  const b = { ...(req.body || {}), id: req.params.id };
  if ('gallery' in b) b.gallery = normGallery(b.gallery);
  if ('audio' in b) b.audio = normAudio(b.audio);
  if ('samplePages' in b) b.samplePages = normPages(b.samplePages);
  if ('artist' in b) b.artist = normArtist(b.artist);
  const p = await store.updateProduct(req.params.id, b);
  if (!p) return res.status(404).json({ error: 'Produkt nicht gefunden' });
  res.json(p);
}));
app.delete('/api/products/:id', requireAdmin, wrap(async (req, res) => { await store.deleteProduct(req.params.id); res.json({ ok: true }); }));

/* ---------- VIDEOS (Lesungen & Talks) — one entry can hold several clips ---------- */
// A "Lesung"/"Talk" is one entry with an ordered list of clips (parts of a long
// reading, an interview, …). Each clip is an S3 upload OR an external URL.
function normClips(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map(c => ({ id: c.id || uid(), label: c.label || '', videoKey: c.videoKey || null, videoUrl: c.videoKey ? '' : (c.videoUrl || ''), sourceType: c.videoKey ? 'upload' : 'url' }))
    .filter(c => c.videoKey || String(c.videoUrl).trim());
}
app.get('/api/videos', wrap(async (_req, res) => res.json(await store.listVideos())));
app.post('/api/videos', requireAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const list = await store.listVideos();
  const clips = normClips(b.clips);
  const v = { id: uid(), title: b.title || { de: '', en: '' }, description: b.description || { de: '', en: '' }, kind: b.kind || 'lesung', clips, posterKey: b.posterKey || null, status: b.status || 'published', order: b.order || (list.length + 1), createdAt: now() };
  res.status(201).json(await store.createVideo(v));
}));
app.put('/api/videos/:id', requireAdmin, wrap(async (req, res) => {
  const b = { ...(req.body || {}), id: req.params.id };
  if ('clips' in b) b.clips = normClips(b.clips);
  const v = await store.updateVideo(req.params.id, b);
  if (!v) return res.status(404).json({ error: 'Video nicht gefunden' });
  res.json(v);
}));
app.delete('/api/videos/:id', requireAdmin, wrap(async (req, res) => { await store.deleteVideo(req.params.id); res.json({ ok: true }); }));

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
  const folder = kind === 'content' ? 'content' : kind === 'video' ? 'videos' : kind === 'audio' ? 'audio' : 'submissions';
  const key = s3.makeKey(folder, filename);
  res.json({ url: await s3.presignPut(key, contentType), key });
}));

/* ---------- SUBMISSIONS ---------- */
app.post('/api/submissions', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.email || !b.category) return res.status(400).json({ error: 'Name, E-Mail und Kategorie erforderlich' });
  // A submission always belongs to a profile: use the logged-in account, or an
  // existing account with the same email; otherwise it stays loose until that
  // email registers (then register() backfills it).
  let userId = req.user ? req.user.id : null;
  if (!userId) { const acct = await store.getUserByEmail(b.email); if (acct) userId = acct.id; }
  const sub = { id: uid(), userId, name: b.name, email: String(b.email).toLowerCase(), category: b.category, subject: b.subject || '', message: b.message || '', fileKey: b.fileKey || null, fileName: b.fileName || null, fileSize: b.fileSize || 0, status: 'neu', createdAt: now() };
  await store.createSubmission(sub);
  try { await sendSubmissionMail(sub); } catch (e) { console.error('[mail]', e.message); }  // admin notification (immediate)
  let pending = false;
  if (await store.isEmailConfirmed(sub.email)) {
    try { await sendSubmissionAck(sub); } catch (e) { console.error('[mail]', e.message); }
  } else {
    pending = true;
    const token = newToken();
    await store.createPending(token, { email: sub.email, type: 'submission', name: sub.name, category: sub.category, subject: sub.subject });
    try { await sendConfirm(sub.email, confirmUrl(token)); } catch (e) { console.error('[mail]', e.message); }
  }
  res.status(201).json({ ok: true, id: sub.id, pending });
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
  const token = newToken();
  await store.addSubscriber(email, now(), token);
  if (await store.isEmailConfirmed(email)) {           // email already confirmed elsewhere -> subscribe directly
    await store.confirmSubscriber(email);
    try { await sendNewsletterWelcome(email); } catch (e) {}
    return res.json({ ok: true, confirmed: true });
  }
  await store.createPending(token, { email, type: 'newsletter' });
  try { await sendConfirm(email, confirmUrl(token)); } catch (e) { console.error('[mail]', e.message); }
  res.status(201).json({ ok: true, pending: true });
}));
app.get('/api/plugins/newsletter/subscribers', requireAdmin, wrap(async (_req, res) => res.json(await store.listSubscribers())));

/* ---------- unified double opt-in confirmation ---------- */
app.get('/api/confirm', wrap(async (req, res) => {
  const token = String(req.query.token || '');
  const p = token ? await store.getPending(token) : null;
  if (p) {
    await store.confirmEmail(p.email);
    if (p.type === 'account') { try { await sendWelcome(p.email, p.name); } catch (e) {} }
    else if (p.type === 'submission') { try { await sendSubmissionAck({ email: p.email, name: p.name, category: p.category, subject: p.subject }); } catch (e) {} }
    else if (p.type === 'newsletter') { await store.confirmSubscriber(p.email); try { await sendNewsletterWelcome(p.email); } catch (e) {} }
    await store.deletePending(token);
  }
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(confirmPage(!!p));
}));

/* ---------- users (accounts) ---------- */
app.get('/api/admin/users', requireAdmin, wrap(async (_req, res) => res.json(await store.listUsers())));

module.exports = app;
