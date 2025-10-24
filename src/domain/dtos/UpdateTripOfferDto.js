/**
 * Update Trip Offer DTO
 * Data Transfer Object for updating an existing trip offer
 */
class UpdateTripOfferDto {
  constructor({ pricePerSeat, totalSeats, notes, status }) {
    // Only include fields that are provided
    if (pricePerSeat !== undefined) this.pricePerSeat = pricePerSeat;
    if (totalSeats !== undefined) this.totalSeats = totalSeats;
    if (notes !== undefined) this.notes = notes;
    if (status !== undefined) this.status = status;
  }

  /**
   * Create DTO from request body
   */
  static fromRequest(body) {
    return new UpdateTripOfferDto({
      pricePerSeat: body.pricePerSeat,
      totalSeats: body.totalSeats,
      notes: body.notes,
      status: body.status
    });
  }

  /**
   * Validate DTO structure
   */
  validate() {
    const errors = [];

    if (this.pricePerSeat !== undefined && typeof this.pricePerSeat !== 'number') {
      errors.push('pricePerSeat must be a number');
    }

    if (this.totalSeats !== undefined && !Number.isInteger(this.totalSeats)) {
      errors.push('totalSeats must be an integer');
    }

    if (this.notes !== undefined && typeof this.notes !== 'string') {
      errors.push('notes must be a string');
    }

    if (this.status !== undefined && !['draft', 'published', 'canceled'].includes(this.status)) {
      errors.push('status must be draft, published, or canceled');
    }

    return errors;
  }

  /**
   * Check if DTO has any fields to update
   */
  hasUpdates() {
    return (
      this.pricePerSeat !== undefined ||
      this.totalSeats !== undefined ||
      this.notes !== undefined ||
      this.status !== undefined
    );
  }
}

module.exports = UpdateTripOfferDto;
