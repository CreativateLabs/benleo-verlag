/**
 * Auth helpers — JWT + role gate.
 * Mirrors AWS Cognito (user pool + admin group). Swap for a Cognito JWT
 * verifier later; req.user shape stays { id, email, name, role }.
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'benleo-dev-secret-change-me';
const JWT_TTL = process.env.JWT_TTL || '7d';

function sign(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_TTL }
  );
}

function readToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  if (req.cookies && req.cookies.benleo_token) return req.cookies.benleo_token;
  return null;
}

// Attaches req.user if a valid token is present; never blocks.
function attachUser(req, _res, next) {
  const token = readToken(req);
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch (e) { /* ignore */ }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Kein Zugriff' });
  next();
}

module.exports = { sign, attachUser, requireAuth, requireAdmin, JWT_SECRET };
