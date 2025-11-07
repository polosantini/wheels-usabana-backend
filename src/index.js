require('dotenv').config();
const app = require('./app');
const cron = require('node-cron');
const connectDB = require('./infrastructure/database/connection');
const TripReminderService = require('./domain/services/TripReminderService');

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Conectar a la base de datos
    await connectDB();
    
    // Initialize trip reminder service
    const tripReminderService = new TripReminderService();
    
    // Start cron job to check for trip reminders every minute
    // Runs at second 0 of every minute: '0 * * * * *'
    cron.schedule('0 * * * * *', async () => {
      await tripReminderService.checkAndSendReminders();
    });
    
    console.log('⏰ Trip reminder scheduler started (runs every minute)');
    
    // Iniciar servidor
    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🌐 Health check: http://localhost:${PORT}/health`);
      console.log(`👤 User registration: http://localhost:${PORT}/api/users`);
      console.log(`📚 API Docs: http://localhost:${PORT}/api-docs`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully');
      server.close(() => {
        console.log('Process terminated');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('SIGINT received, shutting down gracefully');
      server.close(() => {
        console.log('Process terminated');
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

