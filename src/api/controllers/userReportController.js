const UserReportModel = require('../../infrastructure/database/models/UserReportModel');
const TripOfferModel = require('../../infrastructure/database/models/TripOfferModel');
const BookingRequestModel = require('../../infrastructure/database/models/BookingRequestModel');
const UserModel = require('../../infrastructure/database/models/UserModel');

class UserReportController {
  /**
   * POST /users/:userId/report
   * Report a user from a specific trip
   * Only allowed if reporter and reported user participated in the same trip
   */
  async reportUser(req, res, next) {
    try {
      const { userId } = req.params;
      const { tripId, category, reason = '' } = req.body;
      const reporterId = req.user.sub;

      // Validate that tripId is provided
      if (!tripId) {
        return res.status(400).json({
          code: 'missing_trip_id',
          message: 'tripId is required',
          correlationId: req.correlationId
        });
      }

      // Validate that user is not reporting themselves
      if (String(userId) === String(reporterId)) {
        return res.status(400).json({
          code: 'cannot_report_self',
          message: 'No puedes reportarte a ti mismo',
          correlationId: req.correlationId
        });
      }

      // Verify trip exists
      const trip = await TripOfferModel.findById(tripId).lean();
      if (!trip) {
        return res.status(404).json({
          code: 'trip_not_found',
          message: 'Viaje no encontrado',
          correlationId: req.correlationId
        });
      }

      // Verify that the reported user is either the driver or a passenger of this trip
      const isDriver = String(trip.driverId) === String(userId);
      const isPassenger = await BookingRequestModel.findOne({
        tripId,
        passengerId: userId,
        status: 'accepted'
      });

      if (!isDriver && !isPassenger) {
        return res.status(403).json({
          code: 'user_not_in_trip',
          message: 'El usuario reportado no participó en este viaje',
          correlationId: req.correlationId
        });
      }

      // Verify that the reporter participated in the trip
      const reporterIsDriver = String(trip.driverId) === String(reporterId);
      const reporterIsPassenger = await BookingRequestModel.findOne({
        tripId,
        passengerId: reporterId,
        status: 'accepted'
      });

      if (!reporterIsDriver && !reporterIsPassenger) {
        return res.status(403).json({
          code: 'reporter_not_in_trip',
          message: 'Solo puedes reportar usuarios de viajes en los que participaste',
          correlationId: req.correlationId
        });
      }

      // Check for duplicate report
      const existing = await UserReportModel.findOne({
        reportedUserId: userId,
        reporterId,
        tripId
      });

      if (existing) {
        return res.status(429).json({
          code: 'rate_limited',
          message: 'Ya has reportado a este usuario por este viaje',
          correlationId: req.correlationId
        });
      }

      // Create report
      const report = await UserReportModel.create({
        reportedUserId: userId,
        reporterId,
        tripId,
        category,
        reason,
        correlationId: req.correlationId
      });

      console.log(
        `[UserReportController] User reported | reportedUserId: ${userId} | reporterId: ${reporterId} | tripId: ${tripId} | category: ${category} | correlationId: ${req.correlationId}`
      );

      return res.status(201).json({
        ok: true,
        reportId: report._id.toString(),
        category,
        correlationId: req.correlationId
      });
    } catch (err) {
      console.error(
        `[UserReportController] Report error | userId: ${req.params.userId} | reporterId: ${req.user?.sub} | error: ${err.message} | correlationId: ${req.correlationId}`
      );
      next(err);
    }
  }

  /**
   * GET /users/me/reports-received
   * Get all reports made about the current user
   */
  async getMyReportsReceived(req, res, next) {
    try {
      const userId = req.user.sub;

      const reports = await UserReportModel.find({
        reportedUserId: userId
      })
        .populate('reporterId', 'firstName lastName corporateEmail')
        .populate('tripId', 'origin destination departureAt estimatedArrivalAt')
        .sort({ createdAt: -1 })
        .lean();

      const formattedReports = reports
        .filter(report => report.reporterId && report.tripId) // Filter out reports with deleted users/trips
        .map(report => ({
          id: report._id.toString(),
          reporter: {
            id: report.reporterId._id.toString(),
            firstName: report.reporterId.firstName || 'Usuario',
            lastName: report.reporterId.lastName || 'Eliminado',
            corporateEmail: report.reporterId.corporateEmail || 'N/A'
          },
          trip: {
            id: report.tripId._id.toString(),
            origin: (report.tripId.origin && typeof report.tripId.origin === 'object' && report.tripId.origin.text) 
              ? report.tripId.origin.text 
              : (report.tripId.origin || 'Origen desconocido'),
            destination: (report.tripId.destination && typeof report.tripId.destination === 'object' && report.tripId.destination.text) 
              ? report.tripId.destination.text 
              : (report.tripId.destination || 'Destino desconocido'),
            departureAt: report.tripId.departureAt,
            estimatedArrivalAt: report.tripId.estimatedArrivalAt
          },
          category: report.category,
          reason: report.reason || '',
          status: report.status || 'pending',
          createdAt: report.createdAt
        }));

      console.log(
        `[UserReportController] Reports received fetched | userId: ${userId} | count: ${formattedReports.length} | correlationId: ${req.correlationId}`
      );

      return res.status(200).json({
        ok: true,
        reports: formattedReports,
        count: formattedReports.length,
        correlationId: req.correlationId
      });
    } catch (err) {
      console.error(
        `[UserReportController] Get reports received error | userId: ${req.user?.sub} | error: ${err.message} | correlationId: ${req.correlationId}`
      );
      next(err);
    }
  }
}

module.exports = new UserReportController();

