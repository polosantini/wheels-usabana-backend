/**
 * Raw Body Middleware (US-4.1.3)
 * 
 * Preserves raw request body for webhook signature verification.
 * Must be applied BEFORE express.json() middleware.
 * 
 * Stripe (and other providers) require the raw body to verify
 * the webhook signature. Once express.json() parses the body,
 * the raw buffer is lost.
 */

/**
 * Attach raw body to request for webhook signature verification
 * 
 * Usage:
 * app.use('/webhooks', rawBodyMiddleware);
 * app.use(express.json());
 * 
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Next middleware
 */
function rawBodyMiddleware(req, res, next) {
  // Only collect raw body for webhook endpoints.
  // Use originalUrl so middleware works when mounted on routers (req.path may be relative).
  const urlToCheck = req.originalUrl || req.url || '';
  if (urlToCheck.includes('/webhook')) {
    let data = '';

    req.setEncoding('utf8');

    req.on('data', (chunk) => {
      data += chunk;
    });

    req.on('end', () => {
      req.rawBody = data;
      next();
    });
  } else {
    next();
  }
}

module.exports = rawBodyMiddleware;
