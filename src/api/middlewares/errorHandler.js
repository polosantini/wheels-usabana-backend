/**
 * Middleware global para manejo de errores
 * Convierte errores de dominio a respuestas HTTP apropiadas
 */
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

  // Si ya es un DomainError, usar sus propiedades
  if (err.code && err.statusCode) {
    return res.status(err.statusCode).json({
      code: err.code,
      message: err.message,
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

