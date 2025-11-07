const crypto = require('crypto');

/**
 * Simple email provider webhook verifier and parser.
 *
 * Expects header format similar to: t=timestamp,v1=signature
 * Signature is HMAC-SHA256 of `${timestamp}.${rawBody}` using EMAIL_WEBHOOK_SECRET
 */
class EmailProvider {
  constructor() {
    this.secret = process.env.EMAIL_WEBHOOK_SECRET;
    if (!this.secret) {
      // Allow operation in environments without secret for non-production, but verification will fail
      // Throwing would break app require; keep undefined and verify later
    }
  }

  _computeSignature(timestamp, raw) {
    return crypto.createHmac('sha256', this.secret).update(`${timestamp}.${raw}`).digest('hex');
  }

  _parseSignatureHeader(sigHeader) {
    if (!sigHeader || typeof sigHeader !== 'string') return null;
    const parts = sigHeader.split(',').map(p => p.trim());
    const out = {};
    for (const part of parts) {
      const [k, v] = part.split('=');
      out[k] = v;
    }
    return out;
  }

  verifyAndParse(raw, sigHeader) {
    // raw: string
    // sigHeader: header value (string)
    const parsed = this._parseSignatureHeader(sigHeader);
    if (!parsed || !parsed.t || !parsed.v1) {
      const err = new Error('Invalid signature header');
      err.code = 'invalid_signature';
      throw err;
    }

    if (!this.secret) {
      const err = new Error('Email webhook secret not configured');
      err.code = 'invalid_signature';
      throw err;
    }

    const expected = this._computeSignature(parsed.t, raw);

    // Timing-safe compare
    if (process.env.DEBUG_EMAIL_WEBHOOK) {
      console.debug('[EmailProvider] parsed.v1=', parsed.v1);
      console.debug('[EmailProvider] expected=', expected);
      try {
        console.debug('[EmailProvider] raw (first 200 chars)=', typeof raw === 'string' ? raw.slice(0,200) : JSON.stringify(raw).slice(0,200));
      } catch (e) {
        console.debug('[EmailProvider] raw debug error', e.message);
      }
    }
    const sigBuf = Buffer.from(parsed.v1, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      const err = new Error('Webhook signature verification failed');
      err.code = 'invalid_signature';
      throw err;
    }

    // Parse JSON
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      const err = new Error('Invalid JSON payload');
      err.code = 'invalid_payload';
      throw err;
    }

    // Normalize event
    const providerMessageId = payload.MessageID || payload.messageId || payload.message_id;
    const recordType = payload.RecordType || payload.recordType || payload.event || '';
    let eventType = null;
    switch ((recordType || '').toLowerCase()) {
      case 'delivery':
        eventType = 'delivered';
        break;
      case 'bounce':
        eventType = 'bounced';
        break;
      case 'complaint':
        eventType = 'complained';
        break;
      case 'dropped':
        eventType = 'dropped';
        break;
      default:
        eventType = (payload.EventType || payload.eventType || payload.type || '').toLowerCase() || recordType;
    }

    return {
      providerMessageId: providerMessageId,
      eventType,
      recipient: payload.Recipient || payload.recipient || null,
      metadata: payload.Metadata || payload.metadata || {},
      raw: payload,
      providerEventId: payload.EventID || payload.id || payload.eventId || null
    };
  }
}

module.exports = new EmailProvider();
