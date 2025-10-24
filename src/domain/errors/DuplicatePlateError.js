const DomainError = require('./DomainError');

class DuplicatePlateError extends DomainError {
  constructor(message = 'Vehicle plate already exists', code = 'duplicate_plate', plate) {
    super(message, code, 409);
    this.plate = plate;
  }
}

module.exports = DuplicatePlateError;

