/**
 * InvalidTransitionError
 * 
 * Thrown when attempting an illegal state transition.
 * Used for both TripOffer and BookingRequest lifecycle validations.
 * 
 * Example:
 *   throw new InvalidTransitionError(
 *     'Cannot cancel a completed trip',
 *     'completed',
 *     'canceled'
 *   );
 */

const DomainError = require('./DomainError');

class InvalidTransitionError extends DomainError {
  /**
   * @param {string} message - Human-readable error message
   * @param {string} currentState - Current state of the entity
   * @param {string} attemptedState - State that was attempted
   * @param {number} statusCode - HTTP status code (default: 409 Conflict)
   */
  constructor(message, currentState, attemptedState, statusCode = 409) {
    super(message, 'invalid_transition', statusCode);
    this.currentState = currentState;
    this.attemptedState = attemptedState;
    this.name = 'InvalidTransitionError';
  }

  /**
   * Get details object for API response
   * @returns {Object} Transition details
   */
  getDetails() {
    return {
      currentState: this.currentState,
      attemptedState: this.attemptedState
    };
  }
}

module.exports = InvalidTransitionError;
