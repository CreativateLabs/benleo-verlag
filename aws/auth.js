/**
 * JWT auth (bcrypt password hashes stored in DynamoDB).
 * Cognito is provisioned (benleo-users) and can replace this later without
 * changing the API contract — req.user stays { id, email, name, role }.
 */
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'benleo-dev-secret-change-me';

function sign(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}
function attachUser(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (token) { try { req.user = jwt.verify(token, JWT_SECRET); } catch (e) {} }
  next();
}
function requireAuth(req, res, next) { if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet' }); next(); }
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Kein Zugriff' });
  next();
}
module.exports = { sign, attachUser, requireAuth, requireAdmin };
