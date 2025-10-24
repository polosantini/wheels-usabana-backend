const DomainError = require('./DomainError');

class ValidationError extends DomainError {
    constructor(message, code = 'invalid_schema', details = []) {
        super(message, code, 400);
        this.details = details;
    }
}

module.exports = ValidationError;

