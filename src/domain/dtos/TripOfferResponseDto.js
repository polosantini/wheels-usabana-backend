/**
 * Trip Offer Response DTO
 * Data Transfer Object for public API responses
 * Strict, leak-free mapping
 */
class TripOfferResponseDto {
  constructor(tripOffer) {
    this.id = tripOffer.id;
    this.driverId = tripOffer.driverId;
    this.vehicleId = tripOffer.vehicleId;
    this.origin = {
      text: tripOffer.origin.text,
      geo: {
        lat: tripOffer.origin.geo.lat,
        lng: tripOffer.origin.geo.lng
      }
    };
    this.destination = {
      text: tripOffer.destination.text,
      geo: {
        lat: tripOffer.destination.geo.lat,
        lng: tripOffer.destination.geo.lng
      }
    };
    this.departureAt = tripOffer.departureAt.toISOString();
    this.estimatedArrivalAt = tripOffer.estimatedArrivalAt.toISOString();
    this.pricePerSeat = tripOffer.pricePerSeat;
    this.totalSeats = tripOffer.totalSeats;
    this.status = tripOffer.status;
    this.notes = tripOffer.notes || '';
    this.createdAt = tripOffer.createdAt?.toISOString();
    this.updatedAt = tripOffer.updatedAt?.toISOString();
  }

  /**
   * Create response DTO from domain entity
   */
  static fromDomain(tripOffer) {
    if (!tripOffer) return null;
    return new TripOfferResponseDto(tripOffer);
  }

  /**
   * Create array of response DTOs from domain entities
   */
  static fromDomainArray(tripOffers) {
    return tripOffers.map((trip) => TripOfferResponseDto.fromDomain(trip));
  }
}

module.exports = TripOfferResponseDto;
