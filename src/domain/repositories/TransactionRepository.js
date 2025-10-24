/**
 * Transaction Repository Interface (US-4.1.1)
 * 
 * Abstract repository for Transaction persistence.
 * Implementations must provide concrete data access logic.
 */

class TransactionRepository {
  /**
   * Create a new transaction
   * 
   * @param {Transaction} transaction - Transaction entity to create
   * @returns {Promise<Transaction>} Created transaction with ID
   * @throws {Error} If creation fails
   */
  async create(transaction) {
    throw new Error('Method not implemented: create');
  }

  /**
   * Find transaction by ID
   * 
   * @param {string} transactionId - Transaction ID
   * @returns {Promise<Transaction|null>} Transaction or null if not found
   */
  async findById(transactionId) {
    throw new Error('Method not implemented: findById');
  }

  /**
   * Find transaction by provider payment intent ID
   * Used for webhook processing and idempotency
   * 
   * @param {string} providerPaymentIntentId - Provider's payment intent ID
   * @returns {Promise<Transaction|null>} Transaction or null if not found
   */
  async findByProviderPaymentIntentId(providerPaymentIntentId) {
    throw new Error('Method not implemented: findByProviderPaymentIntentId');
  }

  /**
   * Find all transactions for a booking
   * 
   * @param {string} bookingId - Booking ID
   * @returns {Promise<Transaction[]>} Array of transactions
   */
  async findByBookingId(bookingId) {
    throw new Error('Method not implemented: findByBookingId');
  }

  /**
   * Find active or succeeded transaction for a booking
   * Used to check for duplicate payments
   * 
   * @param {string} bookingId - Booking ID
   * @returns {Promise<Transaction|null>} Active or succeeded transaction, or null
   */
  async findActiveOrSucceededByBookingId(bookingId) {
    throw new Error('Method not implemented: findActiveOrSucceededByBookingId');
  }

  /**
   * Find all transactions for a passenger
   * 
   * @param {string} passengerId - Passenger ID
   * @param {Object} [options] - Query options
   * @param {number} [options.page=1] - Page number
   * @param {number} [options.pageSize=10] - Page size
   * @returns {Promise<{items: Transaction[], total: number}>} Paginated transactions
   */
  async findByPassengerId(passengerId, options = {}) {
    throw new Error('Method not implemented: findByPassengerId');
  }

  /**
   * Update transaction status
   * Used by webhook handler to update transaction based on provider events
   * 
   * @param {string} transactionId - Transaction ID
   * @param {string} newStatus - New status
   * @param {Object} [details] - Additional details (errorCode, errorMessage, metadata)
   * @returns {Promise<Transaction>} Updated transaction
   * @throws {Error} If transaction not found or invalid transition
   */
  async updateStatus(transactionId, newStatus, details = {}) {
    throw new Error('Method not implemented: updateStatus');
  }

  /**
   * Delete transaction (for testing only)
   * 
   * @param {string} transactionId - Transaction ID
   * @returns {Promise<boolean>} True if deleted
   */
  async delete(transactionId) {
    throw new Error('Method not implemented: delete');
  }
}

module.exports = TransactionRepository;
