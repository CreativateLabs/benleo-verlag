/**
 * DynamoDB data layer for the Benleo API (single-table: benleo-data).
 * @aws-sdk is provided by the Lambda Node runtime — not bundled.
 *
 *   USER#<email> / USER            → user account (JWT auth)
 *   CONTENT      / <key>           → CMS text/image override
 *   META         / <key>           → CMS field registry (admin discovery)
 *   PRODUCT      / <id>            → product
 *   VIDEO        / <id>            → video (Lesungen & Talks)
 *   EVENT        / <id>            → event / workshop
 *   SUBMISSION   / <id>            → submission (GSI1 by user)
 *   FILE#<key>   / FILE            → file → owner lookup (download auth)
 *   PLUGINS      / STATE           → plugin state map
 *   SUBSCRIBER   / <email>         → newsletter subscriber
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, QueryCommand, BatchWriteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

// Editable templates for the automated emails (appear in admin -> Inhalte -> E-Mails).
const MAIL_FIELDS = [
  { key: 'mail.confirm.body', page: 'mails', label: 'Bestätigungs-Mail – Text (mit Link)', type: 'text', order: 0, default: { de: 'Bitte bestätige deine E-Mail-Adresse, damit wir deine Daten verarbeiten und dir schreiben dürfen. Klicke dazu auf den Button unten.', en: 'Please confirm your email address so we may process your data and contact you. Click the button below.' } },
  { key: 'mail.confirm.button', page: 'mails', label: 'Bestätigungs-Mail – Button-Text', type: 'text', order: 1, default: { de: 'E-Mail bestätigen', en: 'Confirm email' } },
  { key: 'mail.welcome.body', page: 'mails', label: 'Willkommens-Mail (nach Profil-Bestätigung) – Text', type: 'text', order: 2, default: { de: 'Hallo {{name}}, willkommen beim BENLEO VERLAG! Deine E-Mail ist bestätigt und dein Konto ist aktiv. Du kannst dich jederzeit anmelden und den Status deiner Einreichungen sehen.', en: 'Hello {{name}}, welcome to BENLEO VERLAG! Your email is confirmed and your account is active.' } },
  { key: 'mail.ack.body', page: 'mails', label: 'Einreichungs-Bestätigung (nach Bestätigung) – Text', type: 'text', order: 3, default: { de: 'Hallo {{name}}, vielen Dank — wir haben deine Einreichung erhalten und melden uns innerhalb von 10 Werktagen bei dir.', en: 'Hello {{name}}, thank you — we have received your submission and will get back to you within 10 business days.' } },
  { key: 'mail.newsletter.body', page: 'mails', label: 'Newsletter-Bestätigung (nach Anmeldung) – Text', type: 'text', order: 4, default: { de: 'Danke! Deine Newsletter-Anmeldung ist bestätigt. Du erhältst ab sofort unsere Neuigkeiten.', en: 'Thank you! Your newsletter subscription is confirmed.' } },
];

const TABLE = process.env.TABLE || 'benleo-data';
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });

const get = async (PK, SK) => (await doc.send(new GetCommand({ TableName: TABLE, Key: { PK, SK } }))).Item || null;
const put = (item) => doc.send(new PutCommand({ TableName: TABLE, Item: item }));
const del = (PK, SK) => doc.send(new DeleteCommand({ TableName: TABLE, Key: { PK, SK } }));
async function queryPK(PK) {
  const out = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'PK = :p', ExpressionAttributeValues: { ':p': PK } }));
  return out.Items || [];
}
const strip = (it) => { if (!it) return it; const { PK, SK, GSI1PK, GSI1SK, ...rest } = it; return rest; };

module.exports = {
  /* users */
  async getUserByEmail(email) { return strip(await get('USER#' + String(email).toLowerCase(), 'USER')); },
  async createUser(u) { await put({ PK: 'USER#' + u.email, SK: 'USER', ...u }); return u; },

  /* content overrides + registry */
  async getContentAll() {
    const items = await queryPK('CONTENT'); const map = {};
    items.forEach(i => { map[i.SK] = i.img ? { img: i.img } : { de: i.de || '', en: i.en || '' }; });
    return map;
  },
  async putContentText(key, de, en) { await put({ PK: 'CONTENT', SK: key, de: de || '', en: en || '' }); return { de: de || '', en: en || '' }; },
  async putContentImage(key, url) { await put({ PK: 'CONTENT', SK: key, img: url }); return { img: url }; },
  async registerMeta(fields) {
    // Dedupe by key — BatchWrite rejects duplicate keys within one request
    // (e.g. repeated "Mehr erfahren" links share an auto-generated key).
    const map = new Map();
    (fields || []).forEach(f => { if (f && f.key) map.set(f.key, f); });
    const uniq = [...map.values()];
    for (let i = 0; i < uniq.length; i += 25) {
      const batch = uniq.slice(i, i + 25).map(f => ({
        PutRequest: { Item: { PK: 'META', SK: f.key, page: f.page || '', label: f.label || f.key, type: f.type || 'text', order: typeof f.order === 'number' ? f.order : 9999, default: f.default || { de: '', en: '' } } },
      }));
      if (!batch.length) continue;
      let res = await doc.send(new BatchWriteCommand({ RequestItems: { [TABLE]: batch } }));
      let tries = 0;
      while (res.UnprocessedItems && res.UnprocessedItems[TABLE] && res.UnprocessedItems[TABLE].length && tries < 3) {
        res = await doc.send(new BatchWriteCommand({ RequestItems: res.UnprocessedItems })); tries++;
      }
    }
    return uniq.length;
  },
  async getMetaAll() {
    const meta = await queryPK('META');
    const overrides = await this.getContentAll();
    const fromPages = meta.map(m => ({ key: m.SK, page: m.page, label: m.label, type: m.type, order: m.order, default: m.default, value: overrides[m.SK] || null }));
    const mailFields = MAIL_FIELDS.map(f => ({ key: f.key, page: f.page, label: f.label, type: f.type, order: f.order, default: f.default, value: overrides[f.key] || null }));
    return fromPages.concat(mailFields);
  },

  /* products */
  async listProducts() { return (await queryPK('PRODUCT')).map(strip).sort((a, b) => (a.order || 0) - (b.order || 0)); },
  async getProduct(id) { return strip(await get('PRODUCT', id)); },
  async createProduct(p) { await put({ PK: 'PRODUCT', SK: p.id, ...p }); return p; },
  async updateProduct(id, patch) { const cur = await get('PRODUCT', id); if (!cur) return null; const next = { ...cur, ...patch, PK: 'PRODUCT', SK: id }; await put(next); return strip(next); },
  async deleteProduct(id) { await del('PRODUCT', id); },

  /* videos (Lesungen & Talks) — upload to our bucket OR external URL (YouTube/…) */
  async listVideos() { return (await queryPK('VIDEO')).map(strip).sort((a, b) => (a.order || 0) - (b.order || 0)); },
  async getVideo(id) { return strip(await get('VIDEO', id)); },
  async createVideo(v) { await put({ PK: 'VIDEO', SK: v.id, ...v }); return v; },
  async updateVideo(id, patch) { const cur = await get('VIDEO', id); if (!cur) return null; const next = { ...cur, ...patch, PK: 'VIDEO', SK: id }; await put(next); return strip(next); },
  async deleteVideo(id) { await del('VIDEO', id); },

  /* events */
  async listEvents() { return (await queryPK('EVENT')).map(strip).sort((a, b) => (a.order || 0) - (b.order || 0)); },
  async getEvent(id) { return strip(await get('EVENT', id)); },
  async createEvent(e) { await put({ PK: 'EVENT', SK: e.id, ...e }); return e; },
  async updateEvent(id, patch) { const cur = await get('EVENT', id); if (!cur) return null; const next = { ...cur, ...patch, PK: 'EVENT', SK: id }; await put(next); return strip(next); },
  async deleteEvent(id) { await del('EVENT', id); },

  /* submissions */
  async createSubmission(s) {
    const item = { PK: 'SUBMISSION', SK: s.id, ...s };
    if (s.userId) { item.GSI1PK = 'SUBUSER#' + s.userId; item.GSI1SK = s.createdAt; }
    await put(item);
    if (s.fileKey) await put({ PK: 'FILE#' + s.fileKey, SK: 'FILE', submissionId: s.id, userId: s.userId || null });
    return s;
  },
  async listSubmissions() { return (await queryPK('SUBMISSION')).map(strip).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); },
  async listSubmissionsByUser(uid) {
    const out = await doc.send(new QueryCommand({ TableName: TABLE, IndexName: 'GSI1', KeyConditionExpression: 'GSI1PK = :p', ExpressionAttributeValues: { ':p': 'SUBUSER#' + uid }, ScanIndexForward: false }));
    return (out.Items || []).map(strip);
  },
  async updateSubmission(id, patch) { const cur = await get('SUBMISSION', id); if (!cur) return null; const next = { ...cur, ...patch, PK: 'SUBMISSION', SK: id }; await put(next); return strip(next); },
  async getFileOwner(key) { const it = await get('FILE#' + key, 'FILE'); return it ? it.userId : undefined; },
  // Attach every submission made with `email` to the account `userId` (backfill on
  // register, or when a submission arrives for an email that already has a profile).
  // Newsletter sign-ups stay loose; a submission always belongs to its profile.
  async linkSubmissionsByEmail(email, userId) {
    const mail = String(email || '').toLowerCase();
    if (!mail || !userId) return 0;
    const all = await queryPK('SUBMISSION');
    let n = 0;
    for (const it of all) {
      if (String(it.email || '').toLowerCase() === mail && it.userId !== userId) {
        await put({ ...it, userId, GSI1PK: 'SUBUSER#' + userId, GSI1SK: it.createdAt || it.SK });
        if (it.fileKey) await put({ PK: 'FILE#' + it.fileKey, SK: 'FILE', submissionId: it.id, userId });
        n++;
      }
    }
    return n;
  },

  /* plugins */
  async getPluginsState() { const it = await get('PLUGINS', 'STATE'); return it ? (it.state || {}) : {}; },
  async putPluginsState(state) { await put({ PK: 'PLUGINS', SK: 'STATE', state }); return state; },

  /* subscribers (double opt-in) */
  async getSubscriber(email) { return strip(await get('SUBSCRIBER', email)); },
  async addSubscriber(email, createdAt, token) {
    await put({ PK: 'SUBSCRIBER', SK: email, email, createdAt, status: 'pending', token });
    await put({ PK: 'NLTOKEN#' + token, SK: 'T', email });
  },
  async confirmSubscriberByToken(token) {
    const t = await get('NLTOKEN#' + token, 'T');
    if (!t) return null;
    const email = t.email;
    const sub = await get('SUBSCRIBER', email);
    if (sub) { sub.status = 'confirmed'; sub.confirmedAt = new Date().toISOString(); await put(sub); }
    await del('NLTOKEN#' + token, 'T');
    return email;
  },
  async listSubscribers() {
    return (await queryPK('SUBSCRIBER'))
      .map(it => { const o = strip(it); o.email = o.email || it.SK; o.status = o.status || 'confirmed'; return o; })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  async confirmSubscriber(email) { const sub = await get('SUBSCRIBER', email); if (sub) { sub.status = 'confirmed'; sub.confirmedAt = new Date().toISOString(); await put(sub); } },

  /* double opt-in: confirmed emails + pending actions */
  async isEmailConfirmed(email) { return !!(await get('EMAIL#' + String(email).toLowerCase(), 'E')); },
  async confirmEmail(email) { await put({ PK: 'EMAIL#' + String(email).toLowerCase(), SK: 'E', confirmedAt: new Date().toISOString() }); },
  async createPending(token, data) { await put({ PK: 'PENDING#' + token, SK: 'P', ...data, createdAt: new Date().toISOString() }); },
  async getPending(token) { return strip(await get('PENDING#' + token, 'P')); },
  async deletePending(token) { await del('PENDING#' + token, 'P'); },

  /* users (accounts) — small table, scan is fine */
  async listUsers() {
    const out = await doc.send(new ScanCommand({ TableName: TABLE, FilterExpression: 'SK = :u', ExpressionAttributeValues: { ':u': 'USER' } }));
    return (out.Items || []).map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt })).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },

  MAIL_FIELDS,
};
