/**
 * Normalize errors to ensure they carry an HTTP statusCode and a stable code string
 * This is defensive: some callsites throw plain Error or set inconsistent shapes.
 */
const DomainError = require('../../domain/errors/DomainError');

const codeToStatus = {
  invalid_booking_state: 409,
  duplicate_payment: 409,
  booking_already_paid: 409,
  forbidden_owner: 403,
  forbidden: 403,
  unauthorized: 401,
  invalid_signature: 400,
  invalid_schema: 400,
  csrf_mismatch: 403,
  payload_too_large: 413
};

function camelToSnake(str) {
  return str
    .replace(/Error$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

function normalizeError(err) {
  if (!err || typeof err !== 'object') return err;

  // If already has both properties, leave it
  if (typeof err.statusCode === 'number' && typeof err.code === 'string') {
    return err;
  }

  // If it's a DomainError instance, ensure fields exist
  if (err instanceof DomainError) {
    err.statusCode = err.statusCode || 400;
    err.code = err.code || camelToSnake(err.name || 'domain_error');
    return err;
  }

  // If name looks like a DomainError subclass (but instanceof check failed due to module duplication), derive values
  if (typeof err.name === 'string' && err.name.endsWith('Error')) {
    err.code = err.code || camelToSnake(err.name);
    // If it's one of known conflict errors, mark as 409
    if (['InvalidBookingStateError', 'DuplicatePaymentError', 'BookingAlreadyPaidError'].includes(err.name)) {
      err.statusCode = err.statusCode || 409;
    } else {
      err.statusCode = err.statusCode || 400;
    }
    return err;
  }

  // If a string code is present, map to status if possible
  if (typeof err.code === 'string') {
    err.statusCode = err.statusCode || codeToStatus[err.code] || 400;
    return err;
  }

  // If numeric code erroneously used as HTTP status, honor it
  if (typeof err.code === 'number' && err.code >= 400 && err.code < 600) {
    err.statusCode = err.statusCode || err.code;
    // also set a generic code string
    err.code = String(err.code);
    return err;
  }

  // Fallback: mark as 500 (server error) but keep message
  err.statusCode = err.statusCode || 500;
  err.code = err.code || 'internal_server_error';
  return err;
}

module.exports = normalizeError;
