/**
 * Payment Service (US-4.1.2)
 * 
 * Handles payment intent creation and orchestrates interactions
 * between BookingRequest, TripOffer, Transaction, and PaymentProvider.
 * 
 * Business Rules:
 * - Only accepted bookings can create payment intents
 * - One active/succeeded transaction per booking (duplicate prevention)
 * - Amount derived from booking snapshot (immutable)
 * - Passenger must own the booking
 */

const DuplicatePaymentError = require('../errors/DuplicatePaymentError');
const BookingAlreadyPaidError = require('../errors/BookingAlreadyPaidError');
const InvalidBookingStateError = require('../errors/InvalidBookingStateError');
const PaymentProviderError = require('../errors/PaymentProviderError');
const Transaction = require('../entities/Transaction');

class PaymentService {
  /**
   * @param {TransactionRepository} transactionRepository
   * @param {BookingRequestRepository} bookingRequestRepository
   * @param {TripOfferRepository} tripOfferRepository
   * @param {PaymentProvider} paymentProvider
   */
  constructor(
    transactionRepository,
    bookingRequestRepository,
    tripOfferRepository,
    paymentProvider
  ) {
    this.transactionRepository = transactionRepository;
    this.bookingRequestRepository = bookingRequestRepository;
    this.tripOfferRepository = tripOfferRepository;
    this.paymentProvider = paymentProvider;
  }

  /**
   * Create payment intent for a booking
   * 
   * Workflow:
   * 1. Validate booking exists and is owned by passenger
   * 2. Validate booking is in 'accepted' state
   * 3. Check for existing active/succeeded transactions (duplicate prevention)
   * 4. Fetch trip details for amount calculation
   * 5. Create payment intent with provider (Stripe)
   * 6. Create Transaction entity with provider details
   * 7. Persist Transaction
   * 8. Return Transaction
   * 
   * @param {string} bookingId - Booking request ID
   * @param {string} passengerId - Passenger ID (for ownership check)
   * @returns {Promise<Transaction>} Created transaction
   * @throws {Error} If booking not found
   * @throws {Error} If passenger doesn't own booking (forbidden_owner)
   * @throws {InvalidBookingStateError} If booking not accepted
   * @throws {DuplicatePaymentError} If active/succeeded transaction exists
   * @throws {PaymentProviderError} If provider API fails
   */
  async createPaymentIntent(bookingId, passengerId) {
    // 1. Fetch and validate booking
    const booking = await this.bookingRequestRepository.findById(bookingId);
    if (!booking) {
      throw new Error('Booking request not found');
    }

    // 2. Verify ownership
    if (booking.passengerId !== passengerId) {
      const error = new Error('You cannot pay for this booking');
      error.code = 'forbidden_owner';
      error.statusCode = 403;
      throw error;
    }

    // 3. Validate booking state
    if (booking.status !== 'accepted') {
      throw new InvalidBookingStateError(
        "Booking must be 'accepted' to create payment intent",
        { bookingId, currentStatus: booking.status }
      );
    }

    // 4. Check for existing active/succeeded transactions
    const existingTransaction = await this.transactionRepository.findActiveOrSucceededByBookingId(
      bookingId
    );

    if (existingTransaction) {
      if (existingTransaction.isSucceeded()) {
        throw new BookingAlreadyPaidError('Booking has already been paid', {
          bookingId,
          transactionId: existingTransaction.id
        });
      } else {
        throw new DuplicatePaymentError(
          'A payment is already in progress for this booking',
          {
            bookingId,
            transactionId: existingTransaction.id,
            status: existingTransaction.status
          }
        );
      }
    }

    // 5. Fetch trip details for amount calculation
    const trip = await this.tripOfferRepository.findById(booking.tripId);
    if (!trip) {
      throw new Error('Trip offer not found');
    }

    // 6. Calculate amount (immutable snapshot)
    const amount = booking.seats * trip.pricePerSeat;
    const currency = 'COP'; // Default currency

    // 7. Create payment intent with provider
    let providerResponse;
    try {
      providerResponse = await this.paymentProvider.createPaymentIntent({
        amount,
        currency,
        metadata: {
          bookingId: booking.id,
          tripId: trip.id,
          passengerId: booking.passengerId,
          driverId: trip.driverId,
          seats: booking.seats.toString(),
          pricePerSeat: trip.pricePerSeat.toString(),
          origin: trip.origin,
          destination: trip.destination
        }
      });
    } catch (error) {
      // Re-throw PaymentProviderError
      if (error instanceof PaymentProviderError) {
        throw error;
      }
      throw new PaymentProviderError(
        `Failed to create payment intent: ${error.message}`,
        { originalError: error.message }
      );
    }

    // 8. Create Transaction entity
    const transaction = Transaction.createFromBooking({
      booking,
      trip,
      providerPaymentIntentId: providerResponse.paymentIntentId,
      providerClientSecret: providerResponse.clientSecret,
      provider: this.paymentProvider.getProviderName(),
      currency
    });

    // 9. Persist transaction
    const savedTransaction = await this.transactionRepository.create(transaction);

    return savedTransaction;
  }

  /**
   * Get transaction by ID
   * 
   * @param {string} transactionId - Transaction ID
   * @returns {Promise<Transaction|null>} Transaction or null
   */
  async getTransactionById(transactionId) {
    return await this.transactionRepository.findById(transactionId);
  }

  /**
   * Get transactions for a booking
   * 
   * @param {string} bookingId - Booking ID
   * @returns {Promise<Transaction[]>} Array of transactions
   */
  async getTransactionsByBookingId(bookingId) {
    return await this.transactionRepository.findByBookingId(bookingId);
  }

  /**
   * Get transactions for a passenger
   * 
   * @param {string} passengerId - Passenger ID
   * @param {Object} [options] - Query options
   * @returns {Promise<{items: Transaction[], total: number}>}
   */
  async getTransactionsByPassengerId(passengerId, options = {}) {
    return await this.transactionRepository.findByPassengerId(passengerId, options);
  }

  /**
   * Handle webhook event from payment provider (US-4.1.3)
   * 
   * Idempotent processing:
   * 1. Find transaction by providerPaymentIntentId
   * 2. Check if event already processed (metadata.lastEventId)
   * 3. Map provider event type to internal status
   * 4. Update transaction status
   * 
   * Supported events:
   * - payment_intent.succeeded → succeeded
   * - payment_intent.payment_failed → failed
   * - payment_intent.canceled → canceled
   * - payment_intent.processing → processing
   * 
   * @param {Object} event - Parsed webhook event
   * @param {string} event.eventId - Provider event ID (for idempotency)
   * @param {string} event.type - Event type
   * @param {Object} event.data - Event data (payment intent object)
   * @returns {Promise<{ok: boolean, transactionId?: string, alreadyProcessed?: boolean}>}
   */
  async handleWebhookEvent(event) {
    const { eventId, type, data } = event;

    // Extract payment intent ID
    const providerPaymentIntentId = data.id;
    if (!providerPaymentIntentId) {
      throw new Error('Missing payment intent ID in webhook event');
    }

    // Find transaction
    const transaction = await this.transactionRepository.findByProviderPaymentIntentId(
      providerPaymentIntentId
    );

    // Handle unknown payment intents gracefully (202 accepted, log for investigation)
    if (!transaction) {
      console.warn(
        `Webhook received for unknown payment intent: ${providerPaymentIntentId} (event: ${eventId})`
      );
      return {
        ok: true,
        message: 'Unknown payment intent (logged for investigation)'
      };
    }

    // Idempotency check: Has this event already been processed?
    if (transaction.metadata && transaction.metadata.lastEventId === eventId) {
      return {
        ok: true,
        transactionId: transaction.id,
        alreadyProcessed: true
      };
    }

    // Map event type to transaction status
    const statusMap = {
      'payment_intent.succeeded': 'succeeded',
      'payment_intent.payment_failed': 'failed',
      'payment_intent.canceled': 'canceled',
      'payment_intent.processing': 'processing',
      'payment_intent.requires_action': 'requires_payment_method',
      'payment_intent.amount_capturable_updated': 'processing'
    };

    const newStatus = statusMap[type];

    // Ignore unsupported event types
    if (!newStatus) {
      console.info(`Ignoring unsupported webhook event type: ${type}`);
      return {
        ok: true,
        message: `Event type '${type}' not handled`
      };
    }

    // Prepare update details
    const details = {
      metadata: {
        ...transaction.metadata,
        lastEventId: eventId,
        lastEventType: type,
        lastEventTimestamp: new Date().toISOString()
      }
    };

    // Add error details for failed payments
    if (newStatus === 'failed' && data.last_payment_error) {
      details.errorCode = data.last_payment_error.code || 'unknown_error';
      details.errorMessage = data.last_payment_error.message || 'Payment failed';
    }

    // Update transaction status
    try {
      const updatedTransaction = await this.transactionRepository.updateStatus(
        transaction.id,
        newStatus,
        details
      );

      // US-4.1.5: Sync booking status when payment succeeds
      if (newStatus === 'succeeded') {
        try {
          await this.bookingRequestRepository.markAsPaid(transaction.bookingId);
        } catch (syncError) {
          // Log but don't fail webhook (payment already succeeded)
          console.error(
            `Failed to sync booking isPaid status for booking ${transaction.bookingId}:`,
            syncError.message
          );
        }
      }

      return {
        ok: true,
        transactionId: updatedTransaction.id,
        status: updatedTransaction.status
      };
    } catch (error) {
      // If update fails due to invalid transition, it's already in terminal state
      // This is OK for idempotency (e.g., multiple succeeded events)
      if (error.message.includes('terminal state')) {
        return {
          ok: true,
          transactionId: transaction.id,
          alreadyProcessed: true,
          message: 'Transaction already in terminal state'
        };
      }
      throw error;
    }
  }
}

module.exports = PaymentService;
