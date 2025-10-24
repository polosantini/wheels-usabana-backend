/**
 * Payment Controller (US-4.1.2)
 * 
 * Handles payment-related HTTP requests for passengers.
 * 
 * Endpoints:
 * - POST /passengers/payments/intents - Create payment intent
 */

const PaymentService = require('../../domain/services/PaymentService');
const TransactionResponseDto = require('../../domain/dtos/TransactionResponseDto');
const MongoTransactionRepository = require('../../infrastructure/repositories/MongoTransactionRepository');
const MongoBookingRequestRepository = require('../../infrastructure/repositories/MongoBookingRequestRepository');
const MongoTripOfferRepository = require('../../infrastructure/repositories/MongoTripOfferRepository');
const StripePaymentProvider = require('../../infrastructure/payment/StripePaymentProvider');

class PaymentController {
  constructor() {
    // Initialize repositories
    this.transactionRepository = new MongoTransactionRepository();
    this.bookingRequestRepository = new MongoBookingRequestRepository();
    this.tripOfferRepository = new MongoTripOfferRepository();
    this.paymentProvider = new StripePaymentProvider();

    // Initialize service
    this.paymentService = new PaymentService(
      this.transactionRepository,
      this.bookingRequestRepository,
      this.tripOfferRepository,
      this.paymentProvider
    );
  }

  /**
   * Create payment intent for a booking
   * 
   * POST /passengers/payments/intents
   * 
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   * @param {Function} next - Express next middleware
   */
  async createPaymentIntent(req, res, next) {
    const correlationId = req.correlationId;

    try {
      const { bookingId } = req.body;
      const passengerId = req.user.id;

      req.log.info(
        { correlationId, bookingId, passengerId },
        'Creating payment intent for booking'
      );

      // Create payment intent
      const transaction = await this.paymentService.createPaymentIntent(
        bookingId,
        passengerId
      );

      req.log.info(
        {
          correlationId,
          transactionId: transaction.id,
          bookingId,
          amount: transaction.amount,
          status: transaction.status
        },
        'Payment intent created successfully'
      );

      // Return DTO with clientSecret included
      const dto = TransactionResponseDto.fromEntity(transaction, {
        includeClientSecret: true
      });

      // Return 201 Created with custom response format
      return res.status(201).json({
        transactionId: dto.id,
        bookingId: dto.bookingId,
        amount: dto.amount,
        currency: dto.currency,
        provider: 'stripe',
        clientSecret: dto.clientSecret
      });
    } catch (error) {
      req.log.error(
        {
          correlationId,
          error: error.message,
          code: error.code,
          stack: error.stack
        },
        'Failed to create payment intent'
      );

      next(error);
    }
  }

  /**
   * Get transaction by ID
   * 
   * GET /passengers/payments/transactions/:transactionId
   * 
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   * @param {Function} next - Express next middleware
   */
  async getTransaction(req, res, next) {
    const correlationId = req.correlationId;

    try {
      const { transactionId } = req.params;
      const passengerId = req.user.id;

      const transaction = await this.paymentService.getTransactionById(transactionId);

      if (!transaction) {
        const error = new Error('Transaction not found');
        error.code = 'transaction_not_found';
        error.statusCode = 404;
        throw error;
      }

      // Verify ownership
      if (transaction.passengerId !== passengerId) {
        const error = new Error('You cannot view this transaction');
        error.code = 'forbidden_owner';
        error.statusCode = 403;
        throw error;
      }

      const dto = TransactionResponseDto.fromEntity(transaction);

      return res.json(dto);
    } catch (error) {
      req.log.error(
        {
          correlationId,
          error: error.message,
          code: error.code
        },
        'Failed to get transaction'
      );

      next(error);
    }
  }

  /**
   * Get transactions for authenticated passenger (US-4.1.4)
   * 
   * GET /passengers/transactions
   * 
   * Query parameters:
   * - status: Transaction status filter (single or array)
   * - page: Page number (default: 1)
   * - pageSize: Items per page (default: 10, max: 100)
   * 
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   * @param {Function} next - Express next middleware
   */
  async getMyTransactions(req, res, next) {
    const correlationId = req.correlationId;

    try {
      const passengerId = req.user.id;
      const { status, page, pageSize } = req.query;

      req.log.info(
        { correlationId, passengerId, status, page, pageSize },
        'Fetching passenger transactions'
      );

      // Build options object
      const options = {
        page: parseInt(page) || 1,
        pageSize: parseInt(pageSize) || 10
      };

      // Add status filter if provided
      if (status) {
        options.status = status;
      }

      const result = await this.paymentService.getTransactionsByPassengerId(
        passengerId,
        options
      );

      const dtos = result.items.map(t => TransactionResponseDto.fromEntity(t));

      const response = {
        items: dtos,
        page: options.page,
        pageSize: options.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / options.pageSize)
      };

      req.log.info(
        {
          correlationId,
          passengerId,
          itemsReturned: dtos.length,
          total: result.total,
          page: options.page
        },
        'Transactions retrieved successfully'
      );

      return res.json(response);
    } catch (error) {
      req.log.error(
        {
          correlationId,
          error: error.message,
          code: error.code,
          stack: error.stack
        },
        'Failed to get transactions'
      );

      next(error);
    }
  }
}

module.exports = PaymentController;
