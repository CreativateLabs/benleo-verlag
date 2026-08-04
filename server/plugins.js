/**
 * Plugin registry — the "app store" of the Benleo site builder.
 * Each plugin declares metadata + a settings schema. The admin can
 * enable/disable and configure them; the public site activates enabled
 * plugins automatically. Add a new object here -> it appears in the admin.
 *
 * field types: text | url | textarea | select | i18n (per-language {de,en})
 * `public`: which setting keys are exposed to the public site (no secrets).
 */
const DEFINITIONS = [
  {
    id: 'announcement',
    name: 'Ankündigungs-Banner',
    icon: 'megaphone',
    description: 'Ein Hinweis-Banner ganz oben auf der Seite — z. B. „Neuer Roman coming soon".',
    fields: [
      { key: 'message', label: 'Text', type: 'i18n', default: { de: 'Neuer Roman in Arbeit — bald mehr.', en: 'A new novel is in the making — more soon.' } },
      { key: 'link', label: 'Link (optional)', type: 'url', default: '' },
      { key: 'linkLabel', label: 'Link-Text', type: 'i18n', default: { de: 'Mehr erfahren', en: 'Learn more' } },
    ],
    public: ['message', 'link', 'linkLabel'],
  },
  {
    id: 'newsletter',
    name: 'Newsletter-Anmeldung',
    icon: 'mail',
    description: 'Ein Anmeldeblock; sammelt E-Mail-Adressen. Die Abonnenten siehst du hier im Admin.',
    fields: [
      { key: 'heading', label: 'Überschrift', type: 'i18n', default: { de: 'Bleib in Verbindung', en: 'Stay connected' } },
      { key: 'text', label: 'Text', type: 'i18n', default: { de: 'Erhalte Neuigkeiten zu Büchern, Musik und Veranstaltungen.', en: 'Get news about books, music and events.' } },
    ],
    public: ['heading', 'text'],
  },
  {
    id: 'cookie',
    name: 'Cookie-/DSGVO-Banner',
    icon: 'cookie',
    description: 'Ein datenschutzfreundlicher Consent-Hinweis am unteren Rand.',
    fields: [
      { key: 'text', label: 'Text', type: 'i18n', default: { de: 'Wir verwenden nur technisch notwendige Cookies.', en: 'We only use technically necessary cookies.' } },
      { key: 'acceptLabel', label: 'Button-Text', type: 'i18n', default: { de: 'Verstanden', en: 'Got it' } },
    ],
    public: ['text', 'acceptLabel'],
  },
  {
    id: 'analytics',
    name: 'Analytics',
    icon: 'bar-chart-2',
    description: 'Reichweiten-Messung. Trage eine Umami- oder Google-ID ein — das Snippet wird eingebunden.',
    fields: [
      { key: 'provider', label: 'Anbieter', type: 'select', options: ['umami', 'google'], default: 'umami' },
      { key: 'siteId', label: 'Website-/Mess-ID', type: 'text', default: '' },
      { key: 'scriptUrl', label: 'Script-URL (nur Umami)', type: 'url', default: 'https://analytics.umami.is/script.js' },
    ],
    public: ['provider', 'siteId', 'scriptUrl'],
  },
];

const BY_ID = Object.fromEntries(DEFINITIONS.map(d => [d.id, d]));

function defaults(def) {
  const s = {};
  def.fields.forEach(f => { s[f.key] = JSON.parse(JSON.stringify(f.default)); });
  return s;
}

// Ensure every plugin has a state entry with defaults filled in.
function normalize(state) {
  const out = {};
  DEFINITIONS.forEach(def => {
    const cur = state[def.id] || {};
    out[def.id] = {
      enabled: !!cur.enabled,
      settings: Object.assign(defaults(def), cur.settings || {}),
    };
  });
  return out;
}

// Admin view: definitions + current state.
function adminView(state) {
  const norm = normalize(state);
  return DEFINITIONS.map(def => ({
    id: def.id, name: def.name, icon: def.icon, description: def.description,
    fields: def.fields, enabled: norm[def.id].enabled, settings: norm[def.id].settings,
  }));
}

// Public view: only enabled plugins, only public settings.
function publicView(state) {
  const norm = normalize(state);
  const out = {};
  DEFINITIONS.forEach(def => {
    if (!norm[def.id].enabled) return;
    const s = {};
    def.public.forEach(k => { s[k] = norm[def.id].settings[k]; });
    out[def.id] = s;
  });
  return out;
}

module.exports = { DEFINITIONS, BY_ID, defaults, normalize, adminView, publicView };
