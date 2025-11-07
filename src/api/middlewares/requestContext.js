const { v4: uuidv4 } = require('uuid');
const AuthService = require('../../domain/services/AuthService');

/**
 * Request context middleware
 * - attaches req.id (UUID v4) and response header X-Request-Id
 * - derives actor from access_token cookie when present (best-effort)
 * - for internal paths (cron/webhooks) missing/invalid JWT -> actor: system
 * - ensures req.correlationId falls back to req.id so structured logs and audits share the same id
 */
module.exports = async function requestContext(req, res, next) {
  try {
    // request id
    const id = uuidv4();
    req.id = id;
    // expose header
    res.setHeader('X-Request-Id', id);

    // Ensure correlationId exists and falls back to request id
    if (!req.correlationId) req.correlationId = id;

    // Try to derive actor from access_token cookie (best-effort)
    const token = req.cookies && req.cookies.access_token;
    if (token) {
      try {
        const auth = new AuthService();
        const decoded = auth.verifyAccessToken(token);
        // Map role to actor type
        const actorType = (decoded && decoded.role && String(decoded.role).toLowerCase() === 'admin') ? 'admin' : 'user';
        req.actor = {
          type: actorType,
          id: decoded.sub || null,
          roles: decoded.role ? [decoded.role] : []
        };
      } catch (err) {
        // invalid token -> only map to 'system' when request is an internal webhook/cron path
        const path = (req.path || '').toLowerCase();
        if (path.startsWith('/internal') || path.startsWith('/notifications') || path.startsWith('/cron') || path.includes('/webhook')) {
          req.actor = { type: 'system', id: 'system', roles: ['system'] };
        } else {
          // leave req.actor undefined for anonymous requests
          req.actor = null;
        }
      }
    } else {
      // No token present: if internal path, set system actor
      const path = (req.path || '').toLowerCase();
      if (path.startsWith('/internal') || path.startsWith('/notifications') || path.startsWith('/cron') || path.includes('/webhook')) {
        req.actor = { type: 'system', id: 'system', roles: ['system'] };
      } else {
        req.actor = null;
      }
    }

    // Expose small helper to easily inject correlationId into audit payloads and structured logs
    req.withCorrelation = (payload) => {
      if (!payload || typeof payload !== 'object') return { correlationId: req.correlationId };
      return Object.assign({}, payload, { correlationId: req.correlationId });
    };

    next();
  } catch (err) {
    // Non-fatal: attach minimal defaults and continue
    req.id = req.id || uuidv4();
    if (!req.correlationId) req.correlationId = req.id;
    req.actor = req.actor || null;
    req.withCorrelation = (payload) => Object.assign({}, payload || {}, { correlationId: req.correlationId });
    next();
  }
};
