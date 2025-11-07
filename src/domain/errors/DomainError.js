class DomainError extends Error {
  constructor(message, statusCode = 500, code = 'domain_error', details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

module.exports = DomainError;

