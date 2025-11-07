/**
 * Template Registry Service
 *
 * Lightweight in-memory registry for notification templates used by admin endpoints.
 * Stores versioned entries per {type, locale} and provides a validator/linter for drafts.
 */

const defaultBundles = {
  en: {
    'common.team': 'Wheels Team',
    'common.thanks': 'Thanks'
  },
  es: {
    'common.team': 'Equipo Wheels'
    // es will fallback to en for missing keys
  }
};

function extractPlaceholders(str) {
  if (!str || typeof str !== 'string') return [];
  const re = /{{\s*([a-zA-Z0-9_.]+)\s*}}/g;
  const out = new Set();
  let m;
  while ((m = re.exec(str)) !== null) {
    out.add(m[1]);
  }
  return Array.from(out);
}

function extractPartialRefs(str) {
  if (!str || typeof str !== 'string') return [];
  const re = /{{>\s*([a-zA-Z0-9_.\-]+)\s*}}/g;
  const out = new Set();
  let m;
  while ((m = re.exec(str)) !== null) {
    out.add(m[1]);
  }
  return Array.from(out);
}

function detectUnsafeHtml(str) {
  if (!str || typeof str !== 'string') return [];
  const issues = [];
  const lowered = str.toLowerCase();
  if (/<script\b/.test(lowered)) issues.push('script_tag');
  if (/on[a-z]+\s*=/.test(lowered)) issues.push('inline_event_handler');
  if (/<iframe\b/.test(lowered)) issues.push('iframe_tag');
  if (/javascript:\s*/.test(lowered)) issues.push('javascript_href');
  return issues;
}

class TemplateRegistry {
  constructor() {
    // store keyed by `${type}:${locale}`
    this.store = new Map();

    // seed with nothing by default; admin APIs will validate drafts (no persistence yet)
    this.bundles = defaultBundles;
  }

  listMetadata() {
    const items = [];
    for (const value of this.store.values()) {
      items.push({ type: value.type, locale: value.locale, version: value.version || 1, updatedAt: value.updatedAt });
    }
    return items;
  }

  // Register or update a template entry (not used by validate endpoint, but available)
  upsert(entry) {
    const key = `${entry.type}:${entry.locale}`;
    const now = new Date().toISOString();
    const existing = this.store.get(key) || {};
    const version = (existing.version || 0) + 1;
    this.store.set(key, Object.assign({}, entry, { version, updatedAt: now }));
    return this.store.get(key);
  }

  // Validate a draft payload. Returns { valid: true, warnings: [] } or throws an error-like object
  validateDraft(draft) {
    // draft: { type, locale, subject, html, text, schema, partials }
    const errors = [];
    const warnings = [];

    if (!draft || typeof draft !== 'object') {
      throw { code: 'invalid_payload', message: 'Empty or invalid payload' };
    }

    const { type, locale = 'en', subject = '', html = '', text = '', schema = {}, partials = {} } = draft;

    if (!type || typeof type !== 'string') {
      throw { code: 'invalid_payload', message: 'Missing required field: type' };
    }

    // Collect placeholders from subject/html/text and from partials
    const placeholders = new Set();
    extractPlaceholders(subject).forEach(p => placeholders.add(p));
    extractPlaceholders(html).forEach(p => placeholders.add(p));
    extractPlaceholders(text).forEach(p => placeholders.add(p));
    Object.values(partials || {}).forEach(p => extractPlaceholders(p).forEach(v => placeholders.add(v)));

    // Check partial references present
    const partialRefs = new Set();
    extractPartialRefs(subject).forEach(p => partialRefs.add(p));
    extractPartialRefs(html).forEach(p => partialRefs.add(p));
    extractPartialRefs(text).forEach(p => partialRefs.add(p));
    // Ensure each referenced partial exists in partials
    for (const pr of partialRefs) {
      if (!partials || typeof partials[pr] !== 'string') {
        throw { code: 'missing_partial', message: `Missing partial: ${pr}` };
      }
    }

    // Validate JSON-Schema 'required' variables exist in placeholders
    if (schema && typeof schema === 'object' && Array.isArray(schema.required)) {
      for (const reqVar of schema.required) {
        if (!placeholders.has(reqVar)) {
          // explicit error per acceptance example
          throw { code: 'invalid_schema', message: `Missing required variable: ${reqVar}` };
        }
      }
    }

    // Detect unsafe HTML in html and partials
    const unsafeInHtml = detectUnsafeHtml(html);
    if (unsafeInHtml.length) {
      throw { code: 'invalid_html', message: `Unsafe HTML features detected: ${unsafeInHtml.join(',')}` };
    }
    for (const [pname, pbody] of Object.entries(partials || {})) {
      const u = detectUnsafeHtml(pbody);
      if (u.length) {
        throw { code: 'invalid_html', message: `Unsafe HTML in partial '${pname}': ${u.join(',')}` };
      }
    }

    // i18n key checks: detect usages like {{t 'key'}} or {{t "key"}}
    const i18nRe = /{{\s*t\s+['"]([^'"]+)['"]\s*}}/g;
    function checkI18nIn(str) {
      const keys = [];
      if (!str || typeof str !== 'string') return keys;
      let m;
      while ((m = i18nRe.exec(str)) !== null) keys.push(m[1]);
      return keys;
    }

    const i18nKeys = new Set();
    checkI18nIn(subject).forEach(k => i18nKeys.add(k));
    checkI18nIn(html).forEach(k => i18nKeys.add(k));
    checkI18nIn(text).forEach(k => i18nKeys.add(k));
    Object.values(partials || {}).forEach(p => checkI18nIn(p).forEach(k => i18nKeys.add(k)));

    for (const key of i18nKeys) {
      const hasLocale = this.bundles[locale] && Object.prototype.hasOwnProperty.call(this.bundles[locale], key);
      const hasEn = this.bundles['en'] && Object.prototype.hasOwnProperty.call(this.bundles['en'], key);
      if (!hasLocale && hasEn) {
        warnings.push(`i18n_missing_locale_key:${key}`);
      }
      if (!hasLocale && !hasEn) {
        throw { code: 'missing_i18n_key', message: `Missing i18n key: ${key}` };
      }
    }

    // No blocking issues found
    return { valid: true, warnings };
  }
}

module.exports = new TemplateRegistry();
