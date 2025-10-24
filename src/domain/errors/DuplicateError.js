const DomainError = require('./DomainError');

class DuplicateError extends DomainError {
    constructor(message, code, metadata = {}) {
        super(message, code, 409);
        this.field = metadata.field;
        this.value = metadata.value;
    }
}

module.exports = DuplicateError;

