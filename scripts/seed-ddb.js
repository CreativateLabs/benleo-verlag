/**
 * Seed the AWS DynamoDB (benleo-data) with the initial admin, products,
 * events and plugin state. Run against the CLIENT account only:
 *   AWS_PROFILE=benleo AWS_REGION=eu-central-1 TABLE=benleo-data node scripts/seed-ddb.js
 * Idempotent-ish: skips collections that already have data.
 */
process.env.TABLE = process.env.TABLE || 'benleo-data';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const store = require('../aws/store');
const { normalize } = require('../aws/plugins');

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@benleo-verlag.de';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'benleo-admin';

async function main() {
  // Safety: confirm we are on the client account
  const sts = require('@aws-sdk/client-sts');
  const who = await new sts.STSClient({}).send(new sts.GetCallerIdentityCommand({}));
  if (who.Account !== '871020805052') throw new Error('FALSCHER ACCOUNT: ' + who.Account + ' — Abbruch');
  console.log('Account bestätigt:', who.Account);

  if (!(await store.getUserByEmail(ADMIN_EMAIL))) {
    await store.createUser({ id: uid(), email: ADMIN_EMAIL.toLowerCase(), name: 'Benleo Admin', role: 'admin', passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10), createdAt: now() });
    console.log('Admin angelegt:', ADMIN_EMAIL, '/', ADMIN_PASSWORD);
  } else console.log('Admin existiert bereits.');

  if ((await store.listProducts()).length === 0) {
    await store.createProduct({ id: uid(), slug: 'alvisano-roman', type: 'roman', title: { de: 'Der Roman von Alvisano', en: 'The Novel by Alvisano' }, author: 'Alvisano', status: 'published', blurName: false, description: { de: 'Das Manuskript von Alvisano — zugleich Grundlage unseres ersten Hörbuchs.', en: 'The manuscript by Alvisano — also the basis of our first audiobook.' }, coverKey: null, amazonUrl: '', order: 1, createdAt: now() });
    await store.createProduct({ id: uid(), slug: 'alvisano-hoerbuch', type: 'hoerbuch', title: { de: 'Das Hörbuch', en: 'The Audiobook' }, author: 'Alvisano', status: 'published', blurName: false, description: { de: 'Die Vertonung des Alvisano-Romans als Hörbuch.', en: 'The audio adaptation of the Alvisano novel.' }, coverKey: null, amazonUrl: '', order: 2, createdAt: now() });
    await store.createProduct({ id: uid(), slug: 'bu-roman', type: 'roman', title: { de: 'BU', en: 'BU' }, author: '', status: 'coming_soon', blurName: true, description: { de: 'Ein neuer Roman einer Schriftstellerin, die im Benleo Verlag verlegt wird. Titel noch in der Findung.', en: 'A new novel by an author to be published by Benleo Verlag. Title still being finalised.' }, coverKey: null, amazonUrl: '', order: 3, createdAt: now() });
    console.log('Produkte angelegt (Roman, Hörbuch, BU).');
  } else console.log('Produkte existieren bereits.');

  if ((await store.listEvents()).length === 0) {
    await store.createEvent({ id: uid(), slug: 'schreibwerkstatt', kind: 'werkstatt', title: { de: 'Schreibwerkstatt', en: 'Writing Workshop' }, description: { de: 'Lerne, wie man ein Buch schreibt — mit ein bis zwei Trainern, an einer festen Location.', en: 'Learn how to write a book — with one or two trainers, at a fixed location.' }, location: 'Bunker', status: 'published', date: '', order: 1, createdAt: now() });
    await store.createEvent({ id: uid(), slug: 'musikwerkstatt', kind: 'werkstatt', title: { de: 'Musikwerkstatt', en: 'Music Workshop' }, description: { de: 'Mach Musik in den Studios des Bunker — bald mehr.', en: 'Make music in the Bunker studios — more soon.' }, location: 'Bunker', status: 'coming_soon', date: '', order: 2, createdAt: now() });
    await store.createEvent({ id: uid(), slug: 'malwerkstatt', kind: 'werkstatt', title: { de: 'Malwerkstatt', en: 'Painting Workshop' }, description: { de: 'Mal-Events und bildende Kunst — aufbauend auf unseren bestehenden Formaten.', en: 'Painting events and visual art — building on our existing formats.' }, location: 'Bunker', status: 'coming_soon', date: '', order: 3, createdAt: now() });
    await store.createEvent({ id: uid(), slug: 'kulturkarte', kind: 'veranstaltung', title: { de: 'Kulturveranstaltungen', en: 'Cultural Events' }, description: { de: 'Lesungen und Kulturveranstaltungen im Bunker. 5-Euro-Kulturkarte an der Abendkasse.', en: 'Readings and cultural events at the Bunker. 5-euro culture card at the box office.' }, location: 'Bunker', status: 'coming_soon', date: '', order: 4, createdAt: now() });
    console.log('Events/Werkstätten angelegt.');
  } else console.log('Events existieren bereits.');

  const plugins = await store.getPluginsState();
  if (!plugins || Object.keys(plugins).length === 0) {
    await store.putPluginsState(normalize({ announcement: { enabled: true }, newsletter: { enabled: true }, cookie: { enabled: true }, analytics: { enabled: false } }));
    console.log('Plugins angelegt (Banner, Newsletter, Cookie aktiv).');
  } else console.log('Plugins existieren bereits.');

  console.log('Seed fertig.');
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
