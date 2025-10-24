/**
 * BookingRequest Domain Entity
 * 
 * Represents a passenger's request to book seats on a trip offer.
 * Encapsulates business logic and invariants for booking requests.
 */

const InvalidTransitionError = require('../errors/InvalidTransitionError');

class BookingRequest {
  constructor({
    id,
    tripId,
    passengerId,
    status = 'pending',
    seats = 1,
    note = '',
    acceptedAt = null,
    acceptedBy = null,
    declinedAt = null,
    declinedBy = null,
    canceledAt = null,
    cancellationReason = '', // Optional audit trail for passenger cancellations
    refundNeeded = false, // Internal flag for refund policy hooks
    isPaid = false, // US-4.1.5: Payment status (read model sync)
    createdAt = new Date(),
    updatedAt = new Date()
  }) {
    this.id = id;
    this.tripId = tripId;
    this.passengerId = passengerId;
    this.status = status;
    this.seats = seats;
    this.note = note;
    this.acceptedAt = acceptedAt;
    this.acceptedBy = acceptedBy;
    this.declinedAt = declinedAt;
    this.declinedBy = declinedBy;
    this.canceledAt = canceledAt;
    this.cancellationReason = cancellationReason; // Audit trail
    this.refundNeeded = refundNeeded; // Internal flag, never exposed in DTOs
    this.isPaid = isPaid; // US-4.1.5: Payment status
    this.createdAt = createdAt;
    this.updatedAt = new Date();

    this.validate();
  }

  /**
   * Validate booking request invariants
   */
  validate() {
    if (!this.tripId) {
      throw new Error('Trip ID is required');
    }

    if (!this.passengerId) {
      throw new Error('Passenger ID is required');
    }

    // Extended status values for US-3.3 and US-3.4
    const validStatuses = [
      'pending',
      'accepted',
      'declined',
      'declined_auto', // US-3.4.2: Driver cancels trip
      'canceled_by_passenger',
      'canceled_by_platform', // US-3.4.2: Driver cancels trip
      'expired'
    ];
    
    if (!validStatuses.includes(this.status)) {
      throw new Error(`Invalid status: ${this.status}`);
    }

    if (!Number.isInteger(this.seats) || this.seats < 1) {
      throw new Error('Seats must be a positive integer');
    }

    if (this.note && this.note.length > 300) {
      throw new Error('Note cannot exceed 300 characters');
    }
  }

  /**
   * Check if this booking is active (not canceled/expired)
   * Active means: pending or accepted
   */
  isActive() {
    return this.status === 'pending' || this.status === 'accepted';
  }

  /**
   * Check if this booking is pending (awaiting driver action)
   */
  isPending() {
    return this.status === 'pending';
  }

  /**
   * Check if this booking has been accepted by driver
   */
  isAccepted() {
    return this.status === 'accepted';
  }

  /**
   * Check if this booking has been declined by driver
   */
  isDeclined() {
    return this.status === 'declined';
  }

  /**
   * Check if this booking has been canceled by passenger
   */
  isCanceledByPassenger() {
    return this.status === 'canceled_by_passenger';
  }

  /**
   * Check if this booking is cancelable by passenger
   * Legal states for cancellation: pending, accepted
   * Cannot cancel: already canceled, declined, expired
   */
  isCancelableByPassenger() {
    return this.status === 'pending' || this.status === 'accepted';
  }

  /**
   * Check if canceling this booking requires seat deallocation
   * Only accepted bookings have seats allocated in the ledger
   */
  needsSeatDeallocation() {
    return this.status === 'accepted';
  }

  /**
   * Check if this booking can be canceled by passenger (legacy)
   * @deprecated Use isCancelableByPassenger() for state machine guard
   */
  canBeCanceledByPassenger() {
    return this.status === 'pending';
  }

  /**
   * Check if this booking can be accepted by driver
   * Only pending requests can be accepted
   */
  canBeAccepted() {
    return this.status === 'pending';
  }

  /**
   * Check if this booking can be declined by driver
   * Only pending requests can be declined
   */
  canBeDeclined() {
    return this.status === 'pending';
  }

  /**
   * Cancel this booking request (passenger-initiated)
   * Legal transitions: pending|accepted → canceled_by_passenger
   * Idempotent: if already canceled, returns without error
   * 
   * @param {boolean} isPaid - Whether the booking was paid (determines refundNeeded flag)
   * @param {boolean} policyEligible - Whether refund policy allows refund (time window check)
   * @param {string} reason - Optional cancellation reason for audit trail
   * @throws {InvalidTransitionError} if booking cannot be canceled from current state
   * @returns {BookingRequest} this instance for chaining
   */
  cancelByPassenger(isPaid = false, policyEligible = true, reason = '') {
    // Idempotent: if already canceled, just return
    if (this.status === 'canceled_by_passenger') {
      return this;
    }

    // State guard: only pending or accepted can be canceled
    if (!this.isCancelableByPassenger()) {
      throw new InvalidTransitionError(
        `Cannot cancel booking with status: ${this.status}. Only pending or accepted bookings can be canceled.`,
        this.status,
        'canceled_by_passenger'
      );
    }

    // Transition to canceled state
    this.status = 'canceled_by_passenger';
    this.canceledAt = new Date();
    this.cancellationReason = reason?.trim() || ''; // Store reason for audit
    this.updatedAt = new Date();

    // Set refund flag if booking was paid and policy allows
    // This flag is checked by refund service (US-4.2) but not exposed in DTOs
    if (isPaid && policyEligible) {
      this.refundNeeded = true;
    }

    return this;
  }

  /**
   * Automatically decline this booking (driver canceled trip)
   * Legal transition: pending → declined_auto
   * Used when driver cancels entire trip (cascade operation)
   * 
   * @throws {InvalidTransitionError} if booking is not pending
   * @returns {BookingRequest} this instance for chaining
   */
  declineAuto() {
    // Idempotent: if already declined_auto, just return
    if (this.status === 'declined_auto') {
      return this;
    }

    // State guard: only pending bookings can be auto-declined
    if (this.status !== 'pending') {
      throw new InvalidTransitionError(
        `Cannot auto-decline booking with status: ${this.status}. Only pending bookings can be auto-declined.`,
        this.status,
        'declined_auto'
      );
    }

    // Transition to declined_auto state
    this.status = 'declined_auto';
    this.declinedAt = new Date();
    this.declinedBy = 'system'; // System-initiated decline
    this.updatedAt = new Date();

    return this;
  }

  /**
   * Cancel this booking by platform (driver canceled trip)
   * Legal transition: accepted → canceled_by_platform
   * Used when driver cancels entire trip (cascade operation)
   * 
   * For paid bookings: Sets refundNeeded flag (always true for platform cancellations)
   * 
   * @param {boolean} isPaid - Whether the booking was paid (determines refundNeeded flag)
   * @throws {InvalidTransitionError} if booking is not accepted
   * @returns {BookingRequest} this instance for chaining
   */
  cancelByPlatform(isPaid = false) {
    // Idempotent: if already canceled_by_platform, just return
    if (this.status === 'canceled_by_platform') {
      return this;
    }

    // State guard: only accepted bookings can be platform-canceled
    if (this.status !== 'accepted') {
      throw new InvalidTransitionError(
        `Cannot platform-cancel booking with status: ${this.status}. Only accepted bookings can be platform-canceled.`,
        this.status,
        'canceled_by_platform'
      );
    }

    // Transition to canceled_by_platform state
    this.status = 'canceled_by_platform';
    this.canceledAt = new Date();
    this.updatedAt = new Date();

    // Platform cancellations always trigger refunds if booking was paid
    // (Policy is 100% refund for driver-initiated cancellations)
    if (isPaid) {
      this.refundNeeded = true;
    }

    return this;
  }

  /**
   * Check if passenger owns this booking
   */
  belongsToPassenger(passengerId) {
    return this.passengerId === passengerId;
  }

  /**
   * Create a plain object representation (for database persistence)
   */
  toObject() {
    return {
      id: this.id,
      tripId: this.tripId,
      passengerId: this.passengerId,
      status: this.status,
      seats: this.seats,
      note: this.note,
      acceptedAt: this.acceptedAt,
      acceptedBy: this.acceptedBy,
      declinedAt: this.declinedAt,
      declinedBy: this.declinedBy,
      canceledAt: this.canceledAt,
      cancellationReason: this.cancellationReason, // Audit trail
      refundNeeded: this.refundNeeded, // Persisted but never exposed in DTOs
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = BookingRequest;

