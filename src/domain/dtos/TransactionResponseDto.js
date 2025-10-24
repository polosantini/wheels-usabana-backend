/**
 * Transaction Response DTO (US-4.1.1)
 * 
 * Public representation of a Transaction for API responses.
 * Excludes sensitive internal fields.
 */

class TransactionResponseDto {
  /**
   * @param {Object} props
   * @param {string} props.id - Transaction ID
   * @param {string} props.bookingId - Associated booking ID
   * @param {number} props.amount - Amount in smallest currency unit
   * @param {string} props.currency - ISO 4217 currency code
   * @param {string} props.status - Transaction status
   * @param {string} [props.clientSecret] - Client secret for frontend (only in create response)
   * @param {string} [props.errorMessage] - Error message if failed
   * @param {Date} props.createdAt - Creation timestamp
   * @param {Date} [props.processedAt] - Processing completion timestamp
   */
  constructor({
    id,
    bookingId,
    amount,
    currency,
    status,
    clientSecret,
    errorMessage,
    createdAt,
    processedAt
  }) {
    this.id = id;
    this.bookingId = bookingId;
    this.amount = amount;
    this.currency = currency;
    this.status = status;
    if (clientSecret) {
      this.clientSecret = clientSecret;
    }
    if (errorMessage) {
      this.errorMessage = errorMessage;
    }
    this.createdAt = createdAt;
    if (processedAt) {
      this.processedAt = processedAt;
    }
  }

  /**
   * Factory: Create from Transaction entity
   * 
   * @param {Transaction} transaction - Transaction domain entity
   * @param {Object} [options] - Options
   * @param {boolean} [options.includeClientSecret=false] - Include client secret
   * @returns {TransactionResponseDto}
   */
  static fromEntity(transaction, options = {}) {
    return new TransactionResponseDto({
      id: transaction.id,
      bookingId: transaction.bookingId,
      amount: transaction.amount,
      currency: transaction.currency,
      status: transaction.status,
      clientSecret: options.includeClientSecret ? transaction.providerClientSecret : undefined,
      errorMessage: transaction.errorMessage,
      createdAt: transaction.createdAt,
      processedAt: transaction.processedAt
    });
  }

  /**
   * Factory: Create from Mongoose model
   * 
   * @param {Object} model - Mongoose Transaction model
   * @param {Object} [options] - Options
   * @param {boolean} [options.includeClientSecret=false] - Include client secret
   * @returns {TransactionResponseDto}
   */
  static fromModel(model, options = {}) {
    return new TransactionResponseDto({
      id: model._id.toString(),
      bookingId: model.bookingId.toString(),
      amount: model.amount,
      currency: model.currency,
      status: model.status,
      clientSecret: options.includeClientSecret ? model.providerClientSecret : undefined,
      errorMessage: model.errorMessage,
      createdAt: model.createdAt,
      processedAt: model.processedAt
    });
  }
}

module.exports = TransactionResponseDto;
