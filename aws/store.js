/**
 * DynamoDB data layer for the Benleo API (single-table: benleo-data).
 * @aws-sdk is provided by the Lambda Node runtime — not bundled.
 *
 *   USER#<email> / USER            → user account (JWT auth)
 *   CONTENT      / <key>           → CMS text/image override
 *   META         / <key>           → CMS field registry (admin discovery)
 *   PRODUCT      / <id>            → product
 *   EVENT        / <id>            → event / workshop
 *   SUBMISSION   / <id>            → submission (GSI1 by user)
 *   FILE#<key>   / FILE            → file → owner lookup (download auth)
 *   PLUGINS      / STATE           → plugin state map
 *   SUBSCRIBER   / <email>         → newsletter subscriber
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, QueryCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

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
        PutRequest: { Item: { PK: 'META', SK: f.key, page: f.page || '', label: f.label || f.key, type: f.type || 'text', default: f.default || { de: '', en: '' } } },
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
    return meta.map(m => ({ key: m.SK, page: m.page, label: m.label, type: m.type, default: m.default, value: overrides[m.SK] || null }));
  },

  /* products */
  async listProducts() { return (await queryPK('PRODUCT')).map(strip).sort((a, b) => (a.order || 0) - (b.order || 0)); },
  async getProduct(id) { return strip(await get('PRODUCT', id)); },
  async createProduct(p) { await put({ PK: 'PRODUCT', SK: p.id, ...p }); return p; },
  async updateProduct(id, patch) { const cur = await get('PRODUCT', id); if (!cur) return null; const next = { ...cur, ...patch, PK: 'PRODUCT', SK: id }; await put(next); return strip(next); },
  async deleteProduct(id) { await del('PRODUCT', id); },

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
  async listSubscribers() { return (await queryPK('SUBSCRIBER')).map(strip).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); },
};
