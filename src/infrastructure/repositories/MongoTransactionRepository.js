/**
 * Mongo Transaction Repository (US-4.1.1)
 * 
 * Concrete MongoDB implementation of TransactionRepository.
 * Handles persistence with idempotency checks and query optimization.
 */

const TransactionRepository = require('../../domain/repositories/TransactionRepository');
const TransactionModel = require('../database/models/TransactionModel');
const Transaction = require('../../domain/entities/Transaction');

class MongoTransactionRepository extends TransactionRepository {
  /**
   * Create a new transaction
   * 
   * @param {Transaction} transaction - Transaction entity to create
   * @returns {Promise<Transaction>} Created transaction with ID
   * @throws {Error} If creation fails (e.g., duplicate providerPaymentIntentId)
   */
  async create(transaction) {
    // Validate entity
    transaction.validate();

    try {
      const model = TransactionModel.fromEntity(transaction);
      const saved = await model.save();
      return saved.toEntity();
    } catch (error) {
      // Handle duplicate key errors
      if (error.code === 11000) {
        if (error.message.includes('providerPaymentIntentId')) {
          throw new Error('Payment intent already exists (duplicate providerPaymentIntentId)');
        }
        throw new Error('Duplicate transaction constraint violation');
      }
      throw error;
    }
  }

  /**
   * Find transaction by ID
   * 
   * @param {string} transactionId - Transaction ID
   * @returns {Promise<Transaction|null>} Transaction or null if not found
   */
  async findById(transactionId) {
    const model = await TransactionModel
      .findById(transactionId)
      .select('+providerClientSecret'); // Include sensitive field

    return model ? model.toEntity() : null;
  }

  /**
   * Find transaction by provider payment intent ID
   * Used for webhook processing and idempotency
   * 
   * @param {string} providerPaymentIntentId - Provider's payment intent ID
   * @returns {Promise<Transaction|null>} Transaction or null if not found
   */
  async findByProviderPaymentIntentId(providerPaymentIntentId) {
    const model = await TransactionModel
      .findOne({ providerPaymentIntentId })
      .select('+providerClientSecret');

    return model ? model.toEntity() : null;
  }

  /**
   * Find all transactions for a booking
   * 
   * @param {string} bookingId - Booking ID
   * @returns {Promise<Transaction[]>} Array of transactions
   */
  async findByBookingId(bookingId) {
    const models = await TransactionModel
      .find({ bookingId })
      .sort({ createdAt: -1 })
      .select('+providerClientSecret');

    return models.map(model => model.toEntity());
  }

  /**
   * Find active or succeeded transaction for a booking
   * Used to check for duplicate payments
   * 
   * Active: requires_payment_method, processing
   * Succeeded: succeeded
   * 
   * @param {string} bookingId - Booking ID
   * @returns {Promise<Transaction|null>} Active or succeeded transaction, or null
   */
  async findActiveOrSucceededByBookingId(bookingId) {
    const model = await TransactionModel
      .findOne({
        bookingId,
        status: {
          $in: ['requires_payment_method', 'processing', 'succeeded']
        }
      })
      .select('+providerClientSecret')
      .sort({ createdAt: -1 }); // Most recent first

    return model ? model.toEntity() : null;
  }

  /**
   * Find transactions by passenger ID
   * Supports pagination and status filtering
   * 
   * @param {string} passengerId - Passenger ID
   * @param {Object} [options] - Query options
   * @param {number} [options.page=1] - Page number
   * @param {number} [options.pageSize=10] - Page size
   * @param {string|string[]} [options.status] - Status filter (single or array)
   * @returns {Promise<{items: Transaction[], total: number}>} Paginated transactions
   */
  async findByPassengerId(passengerId, options = {}) {
    const page = Math.max(1, options.page || 1);
    const pageSize = Math.min(50, Math.max(1, options.pageSize || 10));
    const skip = (page - 1) * pageSize;

    // Build query
    const query = { passengerId };
    
    // Add status filter if provided
    if (options.status) {
      if (Array.isArray(options.status)) {
        query.status = { $in: options.status };
      } else {
        query.status = options.status;
      }
    }

    const [models, total] = await Promise.all([
      TransactionModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize),
      TransactionModel.countDocuments(query)
    ]);

    return {
      items: models.map(model => model.toEntity()),
      total
    };
  }  /**
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
    const model = await TransactionModel
      .findById(transactionId)
      .select('+providerClientSecret');

    if (!model) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    // Convert to entity for business logic validation
    const transaction = model.toEntity();

    // Apply status update (validates transition)
    transaction.updateStatus(newStatus, details);

    // Update model
    model.status = transaction.status;
    model.processedAt = transaction.processedAt;
    if (transaction.errorCode) {
      model.errorCode = transaction.errorCode;
    }
    if (transaction.errorMessage) {
      model.errorMessage = transaction.errorMessage;
    }
    if (transaction.metadata) {
      model.metadata = transaction.metadata;
    }

    await model.save();
    return model.toEntity();
  }

  /**
   * Delete transaction (for testing only)
   * 
   * @param {string} transactionId - Transaction ID
   * @returns {Promise<boolean>} True if deleted
   */
  async delete(transactionId) {
    const result = await TransactionModel.deleteOne({ _id: transactionId });
    return result.deletedCount > 0;
  }
}

module.exports = MongoTransactionRepository;
