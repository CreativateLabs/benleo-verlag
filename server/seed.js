/**
 * Seed the local demo store with an admin user, editable content blocks,
 * the initial products (Alvisano Roman/Hörbuch + "BU" coming soon) and events.
 * Idempotent-ish: only seeds collections that are empty.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db, load, save } = require('./db');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@benleo-verlag.de';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'benleo-admin';

function uid() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }

function seed() {
  load();
  const d = db();

  // --- Admin user ---
  if (!d.users.some(u => u.role === 'admin')) {
    d.users.push({
      id: uid(),
      email: ADMIN_EMAIL,
      name: 'Benleo Admin',
      role: 'admin',
      passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
      createdAt: now(),
    });
    console.log(`[seed] Admin angelegt: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  }

  // --- Editable content blocks (DE/EN) — CMS demo ---
  if (!d.content || Object.keys(d.content).length === 0) {
    d.content = {
      'home.hero.title':   { de: 'Wo Worte zu Welten werden.', en: 'Where Words Become Worlds.' },
      'home.hero.sub':     { de: 'Hier entstehen Beiträge zur Gestaltung einer Welt, in der wir alle gut und gerne friedlich miteinander leben. Durch Kunst, Musik und Belletristik.', en: 'This is where contributions take shape for a world in which we can all live well and gladly together, in peace — through art, music and fiction.' },
      'about.body':        { de: 'BENLEO VERLAG steht für ein künstlerisches und literarisches Programm, das Bewusstsein schafft, Horizonte erweitert und mutige Perspektiven eröffnet.', en: 'BENLEO VERLAG stands for an artistic and literary programme that creates awareness, broadens horizons and opens up bold perspectives.' },
      'events.intro':      { de: 'Der Bunker als Kulturraum für Lesungen und Kulturveranstaltungen — getragen vom Benleo Verlag.', en: 'The Bunker as a cultural space for readings and cultural events — carried by Benleo Verlag.' },
    };
    console.log('[seed] Content-Blöcke angelegt');
  }

  // --- Products ---
  if (d.products.length === 0) {
    d.products = [
      {
        id: uid(), slug: 'alvisano-roman', type: 'roman',
        title: { de: 'Der Roman von Alvisano', en: 'The Novel by Alvisano' },
        author: 'Alvisano', status: 'published', blurName: false,
        description: { de: 'Das Manuskript von Alvisano — zugleich Grundlage unseres ersten Hörbuchs.', en: 'The manuscript by Alvisano — also the basis of our first audiobook.' },
        coverKey: null, amazonUrl: '', order: 1, createdAt: now(),
      },
      {
        id: uid(), slug: 'alvisano-hoerbuch', type: 'hoerbuch',
        title: { de: 'Das Hörbuch', en: 'The Audiobook' },
        author: 'Alvisano', status: 'published', blurName: false,
        description: { de: 'Die Vertonung des Alvisano-Romans als Hörbuch.', en: 'The audio adaptation of the Alvisano novel.' },
        coverKey: null, amazonUrl: '', order: 2, createdAt: now(),
      },
      {
        id: uid(), slug: 'bu-roman', type: 'roman',
        title: { de: 'BU', en: 'BU' },
        author: '', status: 'coming_soon', blurName: true,
        description: { de: 'Ein neuer Roman einer Schriftstellerin, die im Benleo Verlag verlegt wird. Titel noch in der Findung.', en: 'A new novel by an author to be published by Benleo Verlag. Title still being finalised.' },
        coverKey: null, amazonUrl: '', order: 3, createdAt: now(),
      },
    ];
    console.log('[seed] Produkte angelegt (Roman, Hörbuch, BU coming soon)');
  }

  // --- Events / Werkstätten ---
  if (d.events.length === 0) {
    d.events = [
      {
        id: uid(), slug: 'schreibwerkstatt', kind: 'werkstatt',
        title: { de: 'Schreibwerkstatt', en: 'Writing Workshop' },
        description: { de: 'Lerne, wie man ein Buch schreibt — mit ein bis zwei Trainern, an einer festen Location.', en: 'Learn how to write a book — with one or two trainers, at a fixed location.' },
        location: 'Bunker', status: 'published', date: '', order: 1, createdAt: now(),
      },
      {
        id: uid(), slug: 'kulturkarte', kind: 'veranstaltung',
        title: { de: 'Kulturveranstaltungen', en: 'Cultural Events' },
        description: { de: 'Lesungen und Kulturveranstaltungen im Bunker. 5-Euro-Kulturkarte an der Abendkasse.', en: 'Readings and cultural events at the Bunker. 5-euro culture card at the box office.' },
        location: 'Bunker', status: 'coming_soon', date: '', order: 2, createdAt: now(),
      },
    ];
    console.log('[seed] Events/Werkstätten angelegt');
  }

  save();
  console.log('[seed] Fertig.');
}

if (require.main === module) seed();
module.exports = { seed };
