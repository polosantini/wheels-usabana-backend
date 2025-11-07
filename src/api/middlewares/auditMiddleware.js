const auditWriter = require('../../domain/services/auditWriter');

/**
 * Middleware to attach res.audit(session, payload) helper.
 * Usage: await res.audit(session, { actor, action, entity, reason, delta, ip, userAgent, correlationId });
 */
function auditMiddleware(req, res, next) {
  res.audit = async function(session, payload) {
    // allow calling with just payload (no session): res.audit(payload)
    if (!payload && session) {
      payload = session;
      session = null;
    }
    const merged = Object.assign({}, payload || {});
    if (session) merged.session = session;
  // attach request-level metadata if not provided
    if (!merged.ip) merged.ip = req.ip || (req.headers && req.headers['x-forwarded-for']);
    if (!merged.userAgent) merged.userAgent = req.get ? req.get('user-agent') : (req.headers && req.headers['user-agent']);
    if (!merged.correlationId) merged.correlationId = req.correlationId || null;
  // if actor not provided, try to use resolved actor from requestContext
  if (!merged.actor && typeof req.actor !== 'undefined' && req.actor !== null) merged.actor = req.actor;

    return auditWriter.write(merged);
  };

  next();
}

module.exports = auditMiddleware;
