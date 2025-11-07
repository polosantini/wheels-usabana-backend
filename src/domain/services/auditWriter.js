const AuditLogModel = require('../../infrastructure/database/models/AuditLogModel');
const crypto = require('crypto');

/**
 * Canonicalize audit payload into deterministic JSON string for hashing
 */
function canonicalizeForHash({ actor, action, entity, ts, delta, reason, correlationId, ip, userAgent, prevHash }) {
  // Build ordered object
  const obj = {
    actor: { type: actor && actor.type ? actor.type : null, id: actor && actor.id ? actor.id : null },
    action: action || null,
    entity: { type: entity && entity.type ? entity.type : null, id: entity && entity.id ? entity.id : null },
    ts: ts ? (ts instanceof Date ? ts.toISOString() : String(ts)) : new Date().toISOString(),
    delta: delta || null,
    reason: reason || null,
    correlationId: correlationId || null,
    ip: ip || null,
    userAgent: userAgent || null,
    prevHash: prevHash || null
  };
  return JSON.stringify(obj);
}

async function getLatestHash(session) {
  try {
    const prev = await AuditLogModel.findOne({}, { hash: 1 }).sort({ ts: -1 }).session(session).lean();
    return prev && prev.hash ? prev.hash : null;
  } catch (err) {
    // best-effort
    return null;
  }
}

/**
 * Write an audit entry. If session is provided, the write will be done within it.
 * payload: { session, actor:{type,id}, action, entity:{type,id}, reason, delta, ip, userAgent, correlationId, meta }
 */
async function write(payload) {
  const { session, actor, action, entity, reason, delta, ip, userAgent, correlationId, meta } = payload || {};

  // Enforce reason for admin writes
  if (actor && actor.type === 'admin' && (!reason || String(reason).trim().length === 0)) {
    const err = new Error('reason required for admin audit entries');
    err.code = 'invalid_schema';
    throw err;
  }

  const ts = new Date();

  // Determine previous hash (best-effort) within the provided session so chain is consistent when possible
  const prevHash = await getLatestHash(session);

  const canonical = canonicalizeForHash({ actor, action, entity, ts, delta, reason, correlationId, ip, userAgent, prevHash });
  const hash = crypto.createHash('sha256').update(canonical).digest('hex');

  // Compute per-day hmacDay for quick verification (HMAC(secret, date+hash))
  const secret = process.env.AUDIT_HMAC_SECRET || 'dev_audit_secret';
  const dateKey = ts.toISOString().slice(0, 10);
  const hmacDay = crypto.createHmac('sha256', secret).update(dateKey + hash).digest('hex');

  const entry = {
    ts,
    actor: { type: actor && actor.type ? actor.type : null, id: actor && actor.id ? actor.id : null },
    action,
    // Keep new shape (actor/entity objects) but also populate legacy fields for compatibility
    entity: { type: entity && entity.type ? entity.type : null, id: entity && entity.id ? entity.id : null },
    reason: reason || null,
    delta: delta || null,
    ip: ip || null,
    userAgent: userAgent || null,
    correlationId: correlationId || null,
    prevHash: prevHash || null,
    hash,
    hmacDay,
    meta: meta || {}
  };

  // Populate legacy audit model fields (some code paths still rely on old shape)
  // AuditLogModel schema expects: action (string), entity (string), entityId, who, when, what, why
  try {
    entry.entity = entity && entity.type ? String(entity.type) : (typeof entity === 'string' ? entity : null);
    entry.entityId = entity && entity.id ? entity.id : null;
    entry.who = actor && actor.id ? String(actor.id) : null;
    entry.when = ts;
    // Map delta to legacy `what.after` for compatibility
    entry.what = { after: delta || null };
    entry.why = reason || '';
  } catch (e) {
    // ignore mapping errors (best-effort compatibility)
  }

  // Persist within session if provided
  if (session) {
    return AuditLogModel.create([entry], { session });
  }

  return AuditLogModel.create(entry);
}

module.exports = { write };
