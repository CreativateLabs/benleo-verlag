/**
 * BENLEO VERLAG — local demo backend (AWS-portable).
 *
 *   Express API           -> later: API Gateway + Lambda
 *   JWT auth + roles       -> later: Cognito user pool + admin group
 *   JSON store (db.js)     -> later: DynamoDB
 *   disk uploads (multer)  -> later: S3 presigned uploads
 *   nodemailer dev (mailer)-> later: SES
 *
 * Endpoints
 *   POST /api/auth/register | login        GET /api/auth/me
 *   GET  /api/content                       PUT /api/content/:key        (admin)
 *   GET  /api/products                      POST/PUT/DELETE /api/products (admin)
 *   GET  /api/events                        POST/PUT/DELETE /api/events   (admin)
 *   POST /api/submissions (multipart+file)  GET /api/submissions (admin)  GET /api/submissions/mine
 *   GET  /api/files/:key   (admin or owner)
 *   GET  /api/health
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const multer = require('multer');

const { db, save, load } = require('./db');
const { sign, attachUser, requireAuth, requireAdmin } = require('./auth');
const { sendSubmissionMail } = require('./mailer');

const PORT = process.env.PORT || 4000;
const ROOT = path.join(__dirname, '..');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const MAX_UPLOAD = 200 * 1024 * 1024; // 200 MB

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
load();

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

/* ---------- uploads (multer -> disk; mirrors S3) ---------- */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 12);
    cb(null, `${Date.now()}-${uid()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: MAX_UPLOAD } });

/* ---------- app ---------- */
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(attachUser);

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role });

/* ===================== AUTH ===================== */
app.post('/api/auth/register', (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'E-Mail und Passwort erforderlich' });
  const d = db();
  if (d.users.some(u => u.email.toLowerCase() === String(email).toLowerCase()))
    return res.status(409).json({ error: 'E-Mail bereits registriert' });
  const user = {
    id: uid(), email: String(email).toLowerCase(), name: name || '', role: 'user',
    passwordHash: bcrypt.hashSync(String(password), 10), createdAt: now(),
  };
  d.users.push(user); save();
  res.status(201).json({ token: sign(user), user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const d = db();
  const user = d.users.find(u => u.email.toLowerCase() === String(email || '').toLowerCase());
  if (!user || !bcrypt.compareSync(String(password || ''), user.passwordHash))
    return res.status(401).json({ error: 'E-Mail oder Passwort falsch' });
  res.json({ token: sign(user), user: publicUser(user) });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

/* ===================== CONTENT (CMS) ===================== */
app.get('/api/content', (_req, res) => res.json(db().content || {}));

app.put('/api/content/:key', requireAdmin, (req, res) => {
  const { de, en } = req.body || {};
  const d = db();
  d.content = d.content || {};
  d.content[req.params.key] = { de: de || '', en: en || '' };
  save();
  res.json({ key: req.params.key, value: d.content[req.params.key] });
});

/* ===================== PRODUCTS ===================== */
app.get('/api/products', (req, res) => {
  const all = db().products.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  if (req.user && req.user.role === 'admin') return res.json(all);
  res.json(all); // demo: all visible; "coming_soon" is a display state, not hidden
});

app.post('/api/products', requireAdmin, (req, res) => {
  const b = req.body || {};
  const d = db();
  const product = {
    id: uid(), slug: b.slug || '', type: b.type || 'roman',
    title: b.title || { de: '', en: '' }, author: b.author || '',
    status: b.status || 'published', blurName: !!b.blurName,
    description: b.description || { de: '', en: '' },
    coverKey: b.coverKey || null, amazonUrl: b.amazonUrl || '',
    order: b.order || (d.products.length + 1), createdAt: now(),
  };
  d.products.push(product); save();
  res.status(201).json(product);
});

app.put('/api/products/:id', requireAdmin, (req, res) => {
  const d = db();
  const p = d.products.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Produkt nicht gefunden' });
  Object.assign(p, req.body || {}, { id: p.id, createdAt: p.createdAt });
  save();
  res.json(p);
});

app.delete('/api/products/:id', requireAdmin, (req, res) => {
  const d = db();
  const i = d.products.findIndex(x => x.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Produkt nicht gefunden' });
  d.products.splice(i, 1); save();
  res.json({ ok: true });
});

/* ===================== EVENTS / WERKSTÄTTEN ===================== */
app.get('/api/events', (_req, res) =>
  res.json(db().events.slice().sort((a, b) => (a.order || 0) - (b.order || 0))));

app.post('/api/events', requireAdmin, (req, res) => {
  const b = req.body || {};
  const d = db();
  const ev = {
    id: uid(), slug: b.slug || '', kind: b.kind || 'veranstaltung',
    title: b.title || { de: '', en: '' }, description: b.description || { de: '', en: '' },
    location: b.location || '', status: b.status || 'published',
    date: b.date || '', order: b.order || (d.events.length + 1), createdAt: now(),
  };
  d.events.push(ev); save();
  res.status(201).json(ev);
});

app.put('/api/events/:id', requireAdmin, (req, res) => {
  const d = db();
  const ev = d.events.find(x => x.id === req.params.id);
  if (!ev) return res.status(404).json({ error: 'Event nicht gefunden' });
  Object.assign(ev, req.body || {}, { id: ev.id, createdAt: ev.createdAt });
  save();
  res.json(ev);
});

app.delete('/api/events/:id', requireAdmin, (req, res) => {
  const d = db();
  const i = d.events.findIndex(x => x.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Event nicht gefunden' });
  d.events.splice(i, 1); save();
  res.json({ ok: true });
});

/* ===================== SUBMISSIONS (with upload) ===================== */
app.post('/api/submissions', upload.single('file'), async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.email || !b.category)
    return res.status(400).json({ error: 'Name, E-Mail und Kategorie erforderlich' });
  const d = db();
  const sub = {
    id: uid(),
    userId: req.user ? req.user.id : null,
    name: b.name, email: b.email, category: b.category,
    subject: b.subject || '', message: b.message || '',
    fileKey: req.file ? req.file.filename : null,
    fileName: req.file ? req.file.originalname : null,
    fileSize: req.file ? req.file.size : 0,
    status: 'neu', createdAt: now(),
  };
  d.submissions.push(sub); save();
  try { await sendSubmissionMail(sub); } catch (e) { console.error('[mail] fail:', e.message); }
  res.status(201).json({ ok: true, id: sub.id });
});

app.get('/api/submissions', requireAdmin, (_req, res) =>
  res.json(db().submissions.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))));

app.get('/api/submissions/mine', requireAuth, (req, res) =>
  res.json(db().submissions.filter(s => s.userId === req.user.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))));

app.put('/api/submissions/:id', requireAdmin, (req, res) => {
  const d = db();
  const s = d.submissions.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Einreichung nicht gefunden' });
  if (req.body && typeof req.body.status === 'string') s.status = req.body.status;
  save();
  res.json(s);
});

/* ---------- file download (admin or owner) ---------- */
app.get('/api/files/:key', requireAuth, (req, res) => {
  const key = path.basename(req.params.key); // prevent traversal
  const d = db();
  const sub = d.submissions.find(s => s.fileKey === key);
  const allowed = req.user.role === 'admin' || (sub && sub.userId === req.user.id);
  if (!allowed) return res.status(403).json({ error: 'Kein Zugriff' });
  const file = path.join(UPLOAD_DIR, key);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Datei nicht gefunden' });
  if (sub && sub.fileName) res.setHeader('Content-Disposition', `attachment; filename="${sub.fileName}"`);
  res.sendFile(file);
});

/* ===================== HEALTH + STATIC ===================== */
app.get('/api/health', (_req, res) => res.json({ ok: true, time: now() }));

// public website (root) + admin panel
app.use('/admin', express.static(path.join(ROOT, 'admin')));
app.use(express.static(ROOT, { extensions: ['html'] }));

app.listen(PORT, () => {
  console.log(`\nBENLEO demo backend läuft:  http://localhost:${PORT}`);
  console.log(`  Website:  http://localhost:${PORT}/`);
  console.log(`  Admin:    http://localhost:${PORT}/admin/`);
  console.log(`  API:      http://localhost:${PORT}/api/health\n`);
});

module.exports = app;
