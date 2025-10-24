const DomainError = require('./DomainError');

class OneVehicleRuleError extends DomainError {
  constructor(message = 'Driver already has a vehicle', code = 'one_vehicle_rule', driverId) {
    super(message, code, 409);
    this.driverId = driverId;
  }
}

module.exports = OneVehicleRuleError;

