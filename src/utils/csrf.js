/**
 * CSRF Token Utilities
 * 
 * Double-submit cookie pattern for CSRF protection
 * 
 * How it works:
 * 1. On login, generate a random CSRF token
 * 2. Set it in a non-httpOnly cookie (readable by JS)
 * 3. Client reads cookie and sends it in X-CSRF-Token header
 * 4. Server compares header vs cookie
 * 5. If they match, request is from same origin (CSRF protected)
 */

const crypto = require('crypto');

/**
 * Generate a random CSRF token
 * 
 * @returns {string} - Random hex string (32 bytes = 64 hex chars)
 */
function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Validate CSRF token from cookie and header
 * 
 * @param {string} cookieToken - Token from csrf_token cookie
 * @param {string} headerToken - Token from X-CSRF-Token header
 * @returns {boolean} - true if tokens match, false otherwise
 */
function validateCsrfToken(cookieToken, headerToken) {
  // Both must exist
  if (!cookieToken || !headerToken) {
    return false;
  }

  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(cookieToken),
      Buffer.from(headerToken)
    );
  } catch (error) {
    // If lengths don't match, Buffer.from will fail
    return false;
  }
}

/**
 * Set CSRF token cookie in response
 * 
 * @param {Object} res - Express response object
 * @param {string} token - CSRF token to set
 * @param {Object} options - Cookie options
 */
function setCsrfCookie(res, token, options = {}) {
  const isProduction = process.env.NODE_ENV === 'production';
  
  res.cookie('csrf_token', token, {
    httpOnly: false,           // CRITICAL: Must be readable by JS
    secure: isProduction,      // HTTPS only in production
    sameSite: isProduction ? 'strict' : 'lax',
    maxAge: 2 * 60 * 60 * 1000, // 2 hours (match JWT expiry)
    path: '/',
    ...options
  });
}

/**
 * Clear CSRF token cookie
 * 
 * @param {Object} res - Express response object
 */
function clearCsrfCookie(res) {
  const isProduction = process.env.NODE_ENV === 'production';
  
  res.clearCookie('csrf_token', {
    httpOnly: false,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    path: '/'
  });
}

module.exports = {
  generateCsrfToken,
  validateCsrfToken,
  setCsrfCookie,
  clearCsrfCookie
};

