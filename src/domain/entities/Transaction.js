/**
 * Transaction Entity (US-4.1.1)
 * 
 * Represents a payment transaction for a booking.
 * Immutable snapshots ensure amount/currency cannot change after creation.
 * 
 * Status Flow:
 * - requires_payment_method: Initial state, waiting for client to confirm
 * - processing: Payment being processed by provider
 * - succeeded: Payment completed successfully (terminal)
 * - failed: Payment failed (terminal)
 * - canceled: Payment canceled (terminal)
 * - refunded: Payment refunded (US-4.2) (terminal)
 */

class Transaction {
  /**
   * @param {Object} props
   * @param {string} props.id - Transaction ID (ObjectId string)
   * @param {string} props.bookingId - Booking request ID
   * @param {string} props.tripId - Trip offer ID (denormalized)
   * @param {string} props.driverId - Driver ID (denormalized)
   * @param {string} props.passengerId - Passenger ID (denormalized)
   * @param {number} props.amount - Amount in smallest currency unit (e.g., cents)
   * @param {string} props.currency - ISO 4217 currency code (e.g., 'COP', 'USD')
   * @param {string} props.provider - Payment provider enum ('stripe')
   * @param {string} props.providerPaymentIntentId - Provider's payment intent ID
   * @param {string} props.providerClientSecret - Provider's client secret for frontend
   * @param {string} props.status - Transaction status
   * @param {string} [props.errorCode] - Provider error code if failed
   * @param {string} [props.errorMessage] - Human-readable error message
   * @param {Object} [props.metadata] - Additional provider metadata
   * @param {Date} props.createdAt - Creation timestamp
   * @param {Date} [props.processedAt] - When status became terminal
   */
  constructor({
    id,
    bookingId,
    tripId,
    driverId,
    passengerId,
    amount,
    currency,
    provider,
    providerPaymentIntentId,
    providerClientSecret,
    status,
    errorCode,
    errorMessage,
    metadata,
    createdAt,
    processedAt
  }) {
    this.id = id;
    this.bookingId = bookingId;
    this.tripId = tripId;
    this.driverId = driverId;
    this.passengerId = passengerId;
    this.amount = amount;
    this.currency = currency;
    this.provider = provider;
    this.providerPaymentIntentId = providerPaymentIntentId;
    this.providerClientSecret = providerClientSecret;
    this.status = status;
    this.errorCode = errorCode;
    this.errorMessage = errorMessage;
    this.metadata = metadata || {};
    this.createdAt = createdAt;
    this.processedAt = processedAt;
  }

  /**
   * Factory: Create new transaction from booking and trip data
   * 
   * @param {Object} params
   * @param {Object} params.booking - BookingRequest entity
   * @param {Object} params.trip - TripOffer entity
   * @param {string} params.providerPaymentIntentId - Provider's payment intent ID
   * @param {string} params.providerClientSecret - Provider's client secret
   * @param {string} [params.provider='stripe'] - Payment provider
   * @param {string} [params.currency='COP'] - Currency code
   * @returns {Transaction}
   */
  static createFromBooking({
    booking,
    trip,
    providerPaymentIntentId,
    providerClientSecret,
    provider = 'stripe',
    currency = 'COP'
  }) {
    // Calculate amount: seats × pricePerSeat (immutable snapshot)
    const amount = booking.seats * trip.pricePerSeat;

    return new Transaction({
      id: undefined, // Will be set by repository
      bookingId: booking.id,
      tripId: trip.id,
      driverId: trip.driverId,
      passengerId: booking.passengerId,
      amount,
      currency,
      provider,
      providerPaymentIntentId,
      providerClientSecret,
      status: 'requires_payment_method',
      metadata: {
        seats: booking.seats,
        pricePerSeat: trip.pricePerSeat,
        origin: trip.origin,
        destination: trip.destination
      },
      createdAt: new Date()
    });
  }

  /**
   * Check if transaction is in a terminal state
   * Terminal states cannot be updated further
   * 
   * @returns {boolean}
   */
  isTerminal() {
    return ['succeeded', 'failed', 'canceled', 'refunded'].includes(this.status);
  }

  /**
   * Check if transaction is active (not terminal)
   * 
   * @returns {boolean}
   */
  isActive() {
    return ['requires_payment_method', 'processing'].includes(this.status);
  }

  /**
   * Check if transaction succeeded
   * 
   * @returns {boolean}
   */
  isSucceeded() {
    return this.status === 'succeeded';
  }

  /**
   * Update status based on webhook event
   * Only allows valid state transitions
   * 
   * @param {string} newStatus - New status from webhook
   * @param {Object} [details] - Additional details (errorCode, errorMessage, metadata)
   * @throws {Error} If invalid state transition
   */
  updateStatus(newStatus, details = {}) {
    // Prevent updates to terminal states
    if (this.isTerminal()) {
      throw new Error(
        `Cannot update transaction ${this.id}: already in terminal state ${this.status}`
      );
    }

    // Validate status transition
    const validTransitions = {
      requires_payment_method: ['processing', 'succeeded', 'failed', 'canceled'],
      processing: ['succeeded', 'failed', 'canceled']
    };

    const allowedNext = validTransitions[this.status] || [];
    if (!allowedNext.includes(newStatus)) {
      throw new Error(
        `Invalid transition from ${this.status} to ${newStatus} for transaction ${this.id}`
      );
    }

    // Update status
    this.status = newStatus;

    // Set processedAt for terminal states
    if (this.isTerminal()) {
      this.processedAt = new Date();
    }

    // Update error details if provided
    if (details.errorCode) {
      this.errorCode = details.errorCode;
    }
    if (details.errorMessage) {
      this.errorMessage = details.errorMessage;
    }

    // Merge metadata if provided
    if (details.metadata) {
      this.metadata = { ...this.metadata, ...details.metadata };
    }
  }

  /**
   * Validate transaction invariants
   * 
   * @throws {Error} If validation fails
   */
  validate() {
    if (!this.bookingId) {
      throw new Error('Transaction must have a bookingId');
    }
    if (!this.tripId) {
      throw new Error('Transaction must have a tripId');
    }
    if (!this.passengerId) {
      throw new Error('Transaction must have a passengerId');
    }
    if (!this.amount || this.amount <= 0) {
      throw new Error('Transaction amount must be positive');
    }
    if (!this.currency) {
      throw new Error('Transaction must have a currency');
    }
    if (!this.provider) {
      throw new Error('Transaction must have a provider');
    }
    if (!this.providerPaymentIntentId) {
      throw new Error('Transaction must have a providerPaymentIntentId');
    }
    if (!this.providerClientSecret) {
      throw new Error('Transaction must have a providerClientSecret');
    }

    // Validate status
    const validStatuses = [
      'requires_payment_method',
      'processing',
      'succeeded',
      'failed',
      'canceled',
      'refunded'
    ];
    if (!validStatuses.includes(this.status)) {
      throw new Error(`Invalid transaction status: ${this.status}`);
    }
  }
}

module.exports = Transaction;
