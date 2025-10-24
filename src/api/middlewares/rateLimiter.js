const rateLimit = require('express-rate-limit');

/**
 * Rate limiter para rutas públicas (registro)
 * 10 requests por minuto por IP
 */
const publicRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10, // máximo 10 requests por IP por ventana
  message: {
    code: 'rate_limit_exceeded',
    message: 'Too many requests, please try again later'
  },
  standardHeaders: true, // Incluir headers de rate limit en response
  legacyHeaders: false, // Deshabilitar headers X-RateLimit-*
  skip: (req) => {
    // Saltar rate limiting en desarrollo y testing
    return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
  }
});

/**
 * Rate limiter más permisivo para otras rutas
 * 100 requests por minuto por IP
 */
const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 100, // máximo 100 requests por IP por ventana
  message: {
    code: 'rate_limit_exceeded',
    message: 'Too many requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Saltar rate limiting en desarrollo y testing
    return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
  }
});

/**
 * Rate limiter estricto para login
 * 5 requests por minuto por IP
 * Previene brute-force attacks
 */
const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 5, // máximo 5 intentos de login por IP por ventana
  message: {
    code: 'too_many_attempts',
    message: 'Too many login attempts, try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false, // Count all requests (success or fail)
  keyGenerator: (req) => {
    // Rate limit by IP
    return req.ip;
  },
  skip: (req) => {
    // Saltar rate limiting en desarrollo y testing
    return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
  }
});

/**
 * Rate limiter for password reset requests
 * 3 requests per 15 minutes per IP
 * Prevents abuse of reset functionality
 * 
 * Security: Soft rate limit (generic 429 response)
 */
const passwordResetRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // Maximum 3 reset requests per IP per window
  message: {
    code: 'too_many_attempts',
    message: 'Please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false, // Count all requests
  keyGenerator: (req) => {
    // Rate limit by IP (primary)
    // Could also add email-based limiting in future
    return req.ip;
  },
  skip: (req) => {
    // Skip rate limiting in development and testing
    return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
  }
});

module.exports = {
  publicRateLimiter,
  generalRateLimiter,
  loginRateLimiter,
  passwordResetRateLimiter
};

