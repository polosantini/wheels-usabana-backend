const AuthService = require('../../domain/services/AuthService');

/**
 * Middleware de autenticación JWT
 * 
 * Extrae y verifica el token JWT de la cookie httpOnly 'access_token'.
 * Si es válido, adjunta req.user con la información del usuario.
 * 
 * Contrato de entrada:
 * - Cookie: access_token=<JWT> (httpOnly, Secure, SameSite=Lax)
 * 
 * Contrato de salida (éxito):
 * - req.user = { sub: userId, role: 'passenger'|'driver', email: string, iat, exp }
 * 
 * Errores:
 * - 401 unauthorized: Sin cookie o token inválido
 * - 401 token_expired: Token expirado
 * 
 * Uso:
 * router.get('/users/me', authenticate, controller.getMyProfile);
 * 
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
const authenticate = (req, res, next) => {
  try {
    // Obtener token de la cookie httpOnly 'access_token'
    const token = req.cookies?.access_token;

    if (!token) {
      return res.status(401).json({
        code: 'unauthorized',
        message: 'Missing or invalid session',
        correlationId: req.correlationId
      });
    }

    // Verify token using centralized AuthService
    const authService = new AuthService();
    const decoded = authService.verifyAccessToken(token);

    // Adjuntar información del usuario a req
    // Formato estándar JWT: { sub: userId, role, email, iat, exp, iss, aud }
    req.user = {
      id: decoded.sub,       // Alias for easier access (req.user.id)
      sub: decoded.sub,      // Standard JWT claim
      role: decoded.role,
      email: decoded.email,
      iat: decoded.iat,
      exp: decoded.exp
    };

    next();
  } catch (error) {
    // Token expirado
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        code: 'token_expired',
        message: 'Session expired',
        correlationId: req.correlationId
      });
    }

    // Token inválido (firma incorrecta, formato incorrecto, etc.)
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        code: 'invalid_token',
        message: 'Missing or invalid session',
        correlationId: req.correlationId
      });
    }

    // Error inesperado
    return res.status(401).json({
      code: 'unauthorized',
      message: 'Missing or invalid session',
      correlationId: req.correlationId
    });
  }
};

/**
 * RBAC Middleware - Require specific role(s)
 * 
 * Use after authenticate middleware to enforce role-based access control
 * 
 * @param {string|string[]} allowedRoles - Single role or array of allowed roles
 * @returns {Function} Express middleware
 * 
 * Usage:
 * router.post('/drivers/vehicle', authenticate, requireRole('driver'), controller.createVehicle);
 * router.get('/admin/users', authenticate, requireRole(['admin', 'superadmin']), controller.listUsers);
 * 
 * @param {Object} req - Express request (must have req.user set by authenticate)
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
const requireRole = (allowedRoles) => {
  // Normalize to array
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return (req, res, next) => {
    // Ensure user is authenticated (should be set by authenticate middleware)
    if (!req.user) {
      return res.status(401).json({
        code: 'unauthorized',
        message: 'Authentication required',
        correlationId: req.correlationId
      });
    }

    // Check if user's role is in allowed roles
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        code: 'forbidden',
        message: 'Insufficient permissions',
        details: {
          required: roles,
          current: req.user.role
        },
        correlationId: req.correlationId
      });
    }

    next();
  };
};

module.exports = authenticate;
module.exports.requireRole = requireRole;

