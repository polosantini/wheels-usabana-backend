/**
 * TripReminderService
 * 
 * Service for sending trip reminders 5 minutes before departure.
 * Should be initialized as a cron job.
 */

const NotificationService = require('./NotificationService');
const MongoTripOfferRepository = require('../../infrastructure/repositories/MongoTripOfferRepository');
const MongoBookingRequestRepository = require('../../infrastructure/repositories/MongoBookingRequestRepository');
const TripOfferModel = require('../../infrastructure/database/models/TripOfferModel');
const BookingRequestModel = require('../../infrastructure/database/models/BookingRequestModel');

class TripReminderService {
  constructor() {
    this.tripOfferRepository = new MongoTripOfferRepository();
    this.bookingRequestRepository = new MongoBookingRequestRepository();
  }

  /**
   * Check for trips starting in 5 minutes and send reminders
   * This method should be called by a cron job every minute
   */
  async checkAndSendReminders() {
    try {
      const now = new Date();
      
      // Find trips that start between now+4min and now+6min (5min window)
      // This ensures we catch trips that are ~5 minutes away
      const fourMinutesFromNow = new Date(now.getTime() + 4 * 60 * 1000);
      const sixMinutesFromNow = new Date(now.getTime() + 6 * 60 * 1000);

      const upcomingTrips = await TripOfferModel.find({
        status: 'published',
        departureAt: {
          $gte: fourMinutesFromNow,
          $lte: sixMinutesFromNow
        }
      }).lean();

      // Check if reminders were already sent (avoid duplicates)
      const InAppNotification = require('../../infrastructure/database/models/InAppNotificationModel');
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

      console.log(
        `[TripReminderService] Found ${upcomingTrips.length} trips starting in ~5 minutes`
      );

      let totalNotifications = 0;

      for (const trip of upcomingTrips) {
        try {
          // Check if reminder was already sent for this trip (within last 5 minutes)
          const existingReminder = await InAppNotification.findOne({
            type: 'trip.reminder',
            'data.tripId': trip._id.toString(),
            createdAt: { $gte: fiveMinutesAgo }
          });

          if (existingReminder) {
            console.log(
              `[TripReminderService] Reminder already sent for trip ${trip._id}, skipping`
            );
            continue;
          }

          // Get all accepted bookings for this trip
          const acceptedBookings = await BookingRequestModel.find({
            tripId: trip._id,
            status: 'accepted'
          }).lean();

          const passengerIds = acceptedBookings.map(b => b.passengerId.toString());
          const allUserIds = [trip.driverId.toString(), ...passengerIds];

          // Format departure time
          const departureTime = new Date(trip.departureAt).toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit'
          });

          // Send notification to driver
          await NotificationService.createNotification(
            trip.driverId.toString(),
            'trip.reminder',
            'Tu viaje comienza pronto',
            `Tu viaje inicia en aproximadamente 5 minutos (${departureTime}).`,
            {
              tripId: trip._id.toString(),
              departureAt: trip.departureAt,
              origin: trip.origin?.text || '',
              destination: trip.destination?.text || ''
            }
          );

          // Send notification to all accepted passengers
          if (passengerIds.length > 0) {
            await NotificationService.createNotifications(
              passengerIds,
              'trip.reminder',
              'Tu viaje comienza pronto',
              `El viaje inicia en aproximadamente 5 minutos (${departureTime}).`,
              {
                tripId: trip._id.toString(),
                departureAt: trip.departureAt,
                origin: trip.origin?.text || '',
                destination: trip.destination?.text || ''
              }
            );
          }

          totalNotifications += 1 + passengerIds.length;
          console.log(
            `[TripReminderService] Sent reminders for trip ${trip._id} | driver + ${passengerIds.length} passengers`
          );
        } catch (error) {
          console.error(
            `[TripReminderService] Failed to send reminders for trip ${trip._id}:`,
            error.message
          );
        }
      }

      if (totalNotifications > 0) {
        console.log(
          `[TripReminderService] Completed | sent ${totalNotifications} reminder notifications`
        );
      }

      return totalNotifications;
    } catch (error) {
      console.error('[TripReminderService] Error checking reminders:', error.message);
      return 0;
    }
  }
}

module.exports = TripReminderService;

