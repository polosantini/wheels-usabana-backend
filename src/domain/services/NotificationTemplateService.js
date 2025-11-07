/**
 * NotificationTemplateService
 *
 * Simple template renderer for notification previews.
 * - Read-only: does not send or persist anything
 * - Returns { subject, html, text }
 *
 * This is a minimal renderer used by admin preview endpoints.
 */

const sanitizeHtml = require('sanitize-html');
const { htmlToText } = require('html-to-text');
let inlineCss;
try {
  // optional dependency at runtime
  inlineCss = require('inline-css');
} catch (e) {
  inlineCss = null;
}

class NotificationTemplateService {
  constructor() {
    // metadata describing required variables per template
    this.templateMeta = {
      'payment.succeeded': {
        required: ['firstName', 'amount', 'currency']
      }
    };
    // sanitize-html allowlist
    this.sanitizeOptions = {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat([ 'img' ]),
      allowedAttributes: Object.assign({}, sanitizeHtml.defaults.allowedAttributes, {
        a: [ 'href', 'name', 'target', 'rel' ],
        img: [ 'src', 'alt', 'title', 'width', 'height' ]
      }),
      // Disallow inline event handlers, scripts, iframes by default
      nonTextTags: [ 'script', 'style', 'iframe', 'noscript' ]
    };
  }

  async render(channel, type, variables = {}, locale = 'en', options = { sanitize: true, inlineCss: false }) {
    // Normalize
    const ch = (channel || '').toLowerCase();
    const t = type;

    // Ensure required variables are present for the template
    const meta = this.templateMeta[t];
    if (meta && Array.isArray(meta.required)) {
      const missing = meta.required.filter(k => variables[k] === undefined || variables[k] === null || variables[k] === '');
      if (missing.length) {
        throw { code: 'invalid_schema', message: `Variables missing: ${missing.join(', ')}` };
      }
    }

    switch (t) {
      case 'payment.succeeded': {
        const out = this._renderPaymentSucceeded(ch, variables, locale);
        // Post-process: sanitize, inline CSS (optional), and ensure text fallback
        let html = out.html || '';
        let text = out.text || '';

        if (options && options.sanitize) {
          html = sanitizeHtml(html, this.sanitizeOptions);
        }

        if (options && options.inlineCss && inlineCss) {
          try {
            // inlineCss expects a promise; provide a base URL placeholder
            // eslint-disable-next-line no-await-in-loop
            html = await inlineCss(html, { url: ' ' });
          } catch (e) {
            // If inlining fails, continue with sanitized HTML
            // log silently in tests; caller can enable debug logs if desired
          }
        }

        // Always generate plain-text from sanitized HTML to avoid leaking raw input
        try {
          text = htmlToText(html, { wordwrap: 130 });
        } catch (e) {
          text = out.text || '';
        }

        return { subject: out.subject, html, text };
      }

      default:
        // Unsupported template type
        return null;
    }
  }

  _safeFirstName(v) {
    if (!v || typeof v !== 'string') return 'Customer';
    return v;
  }

  _formatCurrency(amount, currency, locale) {
    try {
      const code = (currency || 'COP').toUpperCase();
      const nf = new Intl.NumberFormat(locale === 'es' ? 'es-CO' : 'en-US', {
        style: 'currency',
        currency: code,
        maximumFractionDigits: 0
      });
      // Use amount as whole units (the app appears to pass 6000 -> "6,000")
      return nf.format(amount);
    } catch (e) {
      if (typeof amount === 'number') return `${currency || ''} ${amount}`;
      return `${currency || ''} ${amount || ''}`;
    }
  }

  _formatTime(isoString, locale) {
    if (!isoString) return 'an unknown time';
    try {
      const d = new Date(isoString);
      if (Number.isNaN(d.getTime())) return 'an unknown time';
      // HH:MM in 24-hour for many locales; pick a locale-aware formatter
      const opts = { hour: '2-digit', minute: '2-digit' };
      return d.toLocaleTimeString(locale === 'es' ? 'es-CO' : 'en-GB', opts);
    } catch (e) {
      return 'an unknown time';
    }
  }

  _renderPaymentSucceeded(channel, vars, locale) {
    const firstName = this._safeFirstName(vars.firstName);
    const amount = typeof vars.amount === 'number' ? vars.amount : Number(vars.amount || 0);
    const currency = vars.currency || 'COP';

    const formattedAmount = this._formatCurrency(amount, currency, locale);
    const timeStr = this._formatTime(vars.tripTime, locale);

    // Build templates per locale
    if (locale === 'es') {
      const subject = '¡Tu pago fue exitoso!';
  const html = `<h1>Gracias, ${firstName}!</h1><p>Tu pago de ${formattedAmount} fue exitoso para el viaje a las ${timeStr}.</p>`;
  const text = `Gracias, ${firstName}! Tu pago de ${formattedAmount} fue exitoso para el viaje a las ${timeStr}.`;

      if (channel === 'in-app') {
        return {
          subject: 'Pago recibido',
          html: `<strong>Gracias, ${firstName}!</strong> Tu pago de ${formattedAmount} fue registrado para el viaje a las ${timeStr}.`,
          text: `Gracias, ${firstName}! Pago de ${formattedAmount} registrado para el viaje a las ${timeStr}.`
        };
      }

    return { subject, html, text };
    }

    // Default: English
    const subject = 'Your payment was successful';
    const html = `<h1>Thanks, ${firstName}!</h1><p>Your payment of ${formattedAmount} was successful for the trip at ${timeStr}.</p>`;
    const text = `Thanks, ${firstName}! Your payment of ${formattedAmount} was successful for the trip at ${timeStr}.`;

    if (channel === 'in-app') {
      return {
        subject: 'Payment received',
        html: `<strong>Thanks, ${firstName}!</strong> Your payment of ${formattedAmount} was recorded for the trip at ${timeStr}.`,
        text: `Thanks, ${firstName}! Payment of ${formattedAmount} recorded for the trip at ${timeStr}.`
      };
    }

    return { subject, html, text };
  }
}

module.exports = NotificationTemplateService;
