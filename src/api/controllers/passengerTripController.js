/**
 * PassengerTripController
 * 
 * Handles passenger trip search and discovery.
 * Only returns published trips with future departure.
 */

const MongoTripOfferRepository = require('../../infrastructure/repositories/MongoTripOfferRepository');
const TripOfferResponseDto = require('../../domain/dtos/TripOfferResponseDto');

class PassengerTripController {
  constructor() {
    this.tripOfferRepository = new MongoTripOfferRepository();
  }

  /**
   * Search published trips (GET /passengers/trips/search)
   * 
   * Filters:
   * - qOrigin: text search in origin (case-insensitive)
   * - qDestination: text search in destination (case-insensitive)
   * - fromDate: minimum departure date
   * - toDate: maximum departure date
   * - fromTime: minimum departure time (HH:MM format)
   * - toTime: maximum departure time (HH:MM format)
   * - minAvailableSeats: minimum available seats required
   * - minPrice: minimum price per seat
   * - maxPrice: maximum price per seat
   * - page: page number (default: 1)
   * - pageSize: results per page (default: 10, max: 50)
   * 
   * Returns only: status='published' AND departureAt > now
   */
  async searchTrips(req, res, next) {
    try {
      const { 
        qOrigin, 
        qDestination, 
        fromDate, 
        toDate, 
        fromTime,
        toTime,
        minAvailableSeats,
        minPrice,
        maxPrice,
        page, 
        pageSize 
      } = req.query;

      console.log(
        `[PassengerTripController] Search trips | qOrigin: ${qOrigin || 'none'} | qDestination: ${qDestination || 'none'} | fromDate: ${fromDate || 'none'} | toDate: ${toDate || 'none'} | fromTime: ${fromTime || 'none'} | toTime: ${toTime || 'none'} | minAvailableSeats: ${minAvailableSeats || 'none'} | minPrice: ${minPrice || 'none'} | maxPrice: ${maxPrice || 'none'} | page: ${page || 1} | pageSize: ${pageSize || 10} | correlationId: ${req.correlationId}`
      );

      // Search published trips
      const result = await this.tripOfferRepository.searchPublishedTrips({
        qOrigin,
        qDestination,
        fromDate,
        toDate,
        fromTime,
        toTime,
        minAvailableSeats: minAvailableSeats ? parseInt(minAvailableSeats) : undefined,
        minPrice: minPrice ? parseFloat(minPrice) : undefined,
        maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
        page: page || 1,
        pageSize: pageSize || 10
      });

      // Convert to DTOs
      const items = TripOfferResponseDto.fromDomainArray(result.trips);

      console.log(
        `[PassengerTripController] Search completed | found: ${result.total} | returned: ${items.length} | correlationId: ${req.correlationId}`
      );

      res.status(200).json({
        items,
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages
      });
    } catch (error) {
      console.error(
        `[PassengerTripController] Search failed | error: ${error.message} | correlationId: ${req.correlationId}`
      );
      next(error);
    }
  }
}

module.exports = PassengerTripController;

