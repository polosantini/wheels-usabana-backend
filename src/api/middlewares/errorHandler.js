/**
 * Middleware global para manejo de errores
 * Convierte errores de dominio a respuestas HTTP apropiadas
 */
const DomainError = require('../../domain/errors/DomainError');

const errorHandler = (err, req, res, next) => {
  // Log del error para debugging
  console.error('Error caught by errorHandler:', {
    message: err.message,
    code: err.code,
    stack: err.stack,
    url: req.url,
    method: req.method,
    correlationId: req.correlationId
  });

  // If it's a DomainError (preferred) or has explicit statusCode/code, use them.
  // Be defensive: some code paths throw plain Error with a `code` string but no
  // numeric statusCode. Normalize those cases into sensible HTTP statuses so
  // integration tests that expect 4xx get the correct response instead of 500.
  if (err instanceof DomainError || err.code || typeof err.statusCode === 'number') {
    // Known mapping for common domain error codes (fallbacks)
    const codeToStatus = {
      invalid_booking_state: 409,
      duplicate_payment: 409,
      forbidden_owner: 403,
      forbidden: 403,
      unauthorized: 401,
      invalid_signature: 400,
      invalid_schema: 400,
      csrf_mismatch: 403,
      payload_too_large: 413
    };

    let status = 500;
    // Prefer explicit statusCode
    if (typeof err.statusCode === 'number') {
      status = err.statusCode;
    } else if (typeof err.code === 'number' && err.code >= 400 && err.code < 600) {
      // Some code paths incorrectly set numeric `code` (e.g. 409) instead of
      // `statusCode`. If we detect that, honor it as the HTTP status.
      status = err.code;
    } else if (err instanceof DomainError && typeof err.statusCode === 'number') {
      status = err.statusCode;
    } else if (err.code && codeToStatus[err.code]) {
      status = codeToStatus[err.code];
    } else if (err instanceof DomainError) {
      // Domain errors without statusCode default to 400 (client error)
      status = 400;
    } else if (err.code) {
      // Generic error with code but unknown mapping -> treat as 400
      status = 400;
    }
    // Determine a stable code string for the response body. Prefer a string
    // `err.code` when available; otherwise derive from DomainError subclass
    // name (e.g. InvalidBookingStateError -> invalid_booking_state).
    let responseCode = 'error';
    if (typeof err.code === 'string') {
      responseCode = err.code;
    } else if (err instanceof DomainError && err.name) {
      // Convert CamelCaseErrorName to snake_case without the trailing 'Error'
      responseCode = err.name.replace(/Error$/, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase();
    }

    return res.status(status).json({
      code: responseCode,
      message: err.message || (status >= 500 ? 'Internal server error' : 'Bad request'),
      ...(err.details && { details: err.details }),
      ...(err.field && { field: err.field }),
      ...(err.value && { value: err.value }),
      correlationId: req.correlationId
    });
  }

  // Errores de Multer (file upload)
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      code: 'payload_too_large',
      message: 'File exceeds limit',
      correlationId: req.correlationId
    });
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      code: 'invalid_file_type',
      message: 'Unexpected file field',
      correlationId: req.correlationId
    });
  }

  // Error genérico del servidor
  console.error('Unhandled error:', err);
  res.status(500).json({
    code: 'internal_server_error',
    message: 'Internal server error',
    correlationId: req.correlationId
  });
};

module.exports = errorHandler;

