/**
 * BookingRequestResponseDto
 * 
 * Data Transfer Object for booking request API responses.
 * Sanitizes internal data and formats for external consumption.
 * 
 * Never exposes:
 * - Internal MongoDB _id (use id instead)
 * - Sensitive passenger data beyond ownership
 * - Internal state machine details
 */

class BookingRequestResponseDto {
  constructor({
    id,
    tripId,
    passengerId,
    status,
    seats,
    note,
    canceledAt,
    isPaid = false, // US-4.1.5: Payment status
    createdAt,
    updatedAt,
    // Optional populated trip data (for list responses)
    trip = null,
    // Optional populated passenger data (for driver view)
    passenger = null
  }) {
    this.id = id;
    this.tripId = tripId;
    this.passengerId = passengerId;
    this.status = status;
    this.seats = seats;
    this.note = note;
    this.canceledAt = canceledAt;
    this.isPaid = isPaid; // US-4.1.5: Payment status
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;

    // If passenger is populated, include passenger info
    if (passenger) {
      this.passenger = {
        id: passenger._id?.toString() || passenger.id,
        firstName: passenger.firstName,
        lastName: passenger.lastName,
        corporateEmail: passenger.corporateEmail
      };
    }

    // If trip is populated, include relevant trip details
    if (trip) {
      this.trip = {
        id: trip.id || trip._id?.toString(),
        origin: trip.origin,
        destination: trip.destination,
        departureAt: trip.departureAt,
        estimatedArrivalAt: trip.estimatedArrivalAt,
        pricePerSeat: trip.pricePerSeat,
        status: trip.status,
        // Include driver info if populated
        driver: trip.driverId && typeof trip.driverId === 'object' ? {
          id: trip.driverId._id?.toString() || trip.driverId.id,
          firstName: trip.driverId.firstName,
          lastName: trip.driverId.lastName,
          corporateEmail: trip.driverId.corporateEmail
        } : undefined
      };
    }
  }

  /**
   * Create DTO from domain entity
   * @param {BookingRequest} bookingRequest - Domain entity
   * @returns {BookingRequestResponseDto}
   */
  static fromDomain(bookingRequest) {
    return new BookingRequestResponseDto({
      id: bookingRequest.id,
      tripId: bookingRequest.tripId,
      passengerId: bookingRequest.passengerId,
      status: bookingRequest.status,
      seats: bookingRequest.seats,
      note: bookingRequest.note,
      canceledAt: bookingRequest.canceledAt,
      isPaid: bookingRequest.isPaid || false, // US-4.1.5
      createdAt: bookingRequest.createdAt,
      updatedAt: bookingRequest.updatedAt
    });
  }

  /**
   * Create DTO from Mongoose document
   * @param {Document} doc - Mongoose document
   * @returns {BookingRequestResponseDto}
   */
  static fromDocument(doc) {
    const obj = doc.toObject ? doc.toObject() : doc;

    return new BookingRequestResponseDto({
      id: obj._id?.toString() || obj.id,
      tripId: obj.tripId?._id?.toString() || obj.tripId?.toString() || obj.tripId,
      passengerId: obj.passengerId?._id?.toString() || obj.passengerId?.toString() || obj.passengerId,
      status: obj.status,
      seats: obj.seats,
      note: obj.note || '',
      canceledAt: obj.canceledAt,
      isPaid: obj.isPaid || false, // US-4.1.5
      createdAt: obj.createdAt,
      updatedAt: obj.updatedAt,
      // Include populated trip if available
      trip: obj.tripId && typeof obj.tripId === 'object' && obj.tripId.origin ? obj.tripId : null,
      // Include populated passenger if available
      passenger: obj.passengerId && typeof obj.passengerId === 'object' && obj.passengerId.firstName ? obj.passengerId : null
    });
  }

  /**
   * Create array of DTOs from domain entities
   * @param {BookingRequest[]} bookingRequests - Array of domain entities
   * @returns {BookingRequestResponseDto[]}
   */
  static fromDomainArray(bookingRequests) {
    return bookingRequests.map((br) => BookingRequestResponseDto.fromDomain(br));
  }

  /**
   * Create array of DTOs from Mongoose documents
   * @param {Document[]} docs - Array of Mongoose documents
   * @returns {BookingRequestResponseDto[]}
   */
  static fromDocumentArray(docs) {
    return docs.map((doc) => BookingRequestResponseDto.fromDocument(doc));
  }
}

module.exports = BookingRequestResponseDto;

