/**
 * CSRF Protection Middleware
 * 
 * Double-submit cookie pattern for state-changing requests
 * 
 * How it works:
 * 1. Client reads csrf_token from cookie (non-httpOnly)
 * 2. Client sends token in X-CSRF-Token header
 * 3. Middleware compares cookie vs header
 * 4. If they match, request is from same origin
 * 
 * Usage:
 * router.patch('/users/me', authenticate, requireCsrf, controller.update);
 * router.post('/drivers/vehicle', authenticate, requireCsrf, controller.create);
 */

const { validateCsrfToken } = require('../../utils/csrf');

/**
 * Require CSRF token for state-changing requests
 * 
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 * 
 * Errors:
 * - 403 csrf_mismatch: Token missing or doesn't match
 */
const requireCsrf = (req, res, next) => {
  // Check if CSRF protection is enabled
  const csrfEnabled = process.env.CSRF_PROTECTION !== 'false';
  
  if (!csrfEnabled) {
    // CSRF protection disabled (e.g., pure SameSite=Strict environment)
    console.log('[requireCsrf] CSRF protection disabled by config');
    return next();
  }

  // Get CSRF token from cookie
  const cookieToken = req.cookies?.csrf_token;
  
  // Get CSRF token from header
  const headerToken = req.headers['x-csrf-token'] || req.headers['X-CSRF-Token'];

  // Validate tokens
  if (!validateCsrfToken(cookieToken, headerToken)) {
    console.log(`[requireCsrf] CSRF validation failed | IP: ${req.ip} | correlationId: ${req.correlationId}`);
    
    return res.status(403).json({
      code: 'csrf_mismatch',
      message: 'CSRF token missing or invalid',
      correlationId: req.correlationId
    });
  }

  // Tokens match, proceed
  next();
};

module.exports = requireCsrf;

