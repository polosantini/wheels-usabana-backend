const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const path = require('path');

// Middlewares personalizados
const correlationId = require('./api/middlewares/correlationId');
const requestContext = require('./api/middlewares/requestContext');
const errorHandler = require('./api/middlewares/errorHandler');
const { generalRateLimiter } = require('./api/middlewares/rateLimiter');
const { serveSwagger } = require('./api/middlewares/swagger');
const { structuredLogger } = require('./api/middlewares/structuredLogger');
const auditMiddleware = require('./api/middlewares/auditMiddleware');

// Rutas
const userRoutes = require('./api/routes/userRoutes');
const authRoutes = require('./api/routes/authRoutes');
const vehicleRoutes = require('./api/routes/vehicleRoutes');
const notificationWebhookRoutes = require('./api/routes/notificationWebhookRoutes');

const app = express();

// Trust proxy para rate limiting y IPs reales
app.set('trust proxy', 1);

// Global middlewares
app.use(helmet());

// CORS Configuration for JWT cookies and credentials
// Allows cross-origin requests with credentials (cookies)
const allowedOrigins = process.env.CORS_ORIGINS 
  ? (process.env.CORS_ORIGINS === '*' ? '*' : process.env.CORS_ORIGINS.split(',').map(origin => origin.trim()))
  : ['http://localhost:5173'];

app.use(cors({
  origin: allowedOrigins === '*' ? true : allowedOrigins,
  credentials: true, // CRITICAL: Allow cookies in cross-origin requests
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS', 'PUT'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  exposedHeaders: ['Set-Cookie'],
  maxAge: 86400 // 24 hours preflight cache
}));

app.use(morgan('combined'));
app.use(cookieParser());
app.use(correlationId);
// Add request context (request id, actor resolution) before structured logging so logs include actor/correlation
app.use(requestContext);
app.use(structuredLogger); // Structured logging with PII redaction
app.use(auditMiddleware);
app.use(generalRateLimiter);

// Mount email notification webhooks BEFORE body parsing so raw body is available
app.use('/notifications/webhooks', notificationWebhookRoutes);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files - serve uploaded files
const uploadDir = process.env.UPLOAD_DIR || 'uploads';
app.use('/uploads', express.static(path.join(__dirname, '..', uploadDir)));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    correlationId: req.correlationId
  });
});

// API Routes
const tripOfferRoutes = require('./api/routes/tripOfferRoutes');
const passengerRoutes = require('./api/routes/passengerRoutes');
const driverRoutes = require('./api/routes/driverRoutes');
const internalRoutes = require('./api/routes/internalRoutes');
const notificationRoutes = require('./api/routes/notificationRoutes');
const reviewRoutes = require('./api/routes/reviewRoutes');
const userReportRoutes = require('./api/routes/userReportRoutes');
const adminRoutes = require('./api/routes/adminRoutes');
app.use('/api/users', userRoutes);
app.use('/api/users', userReportRoutes);
app.use('/auth', authRoutes);
app.use('/api/drivers', vehicleRoutes);
app.use('/drivers', tripOfferRoutes);
app.use('/drivers', driverRoutes);
app.use('/passengers', passengerRoutes);
app.use('/internal', internalRoutes);
// Also expose internal admin routes at the top-level /admin path for test helpers
// Tests expect admin endpoints under /admin; mounting here keeps existing /internal/* paths working
app.use('/', internalRoutes);
app.use('/notifications', notificationRoutes);
// Trip-level routes (reviews)
app.use('/trips', reviewRoutes);
// Admin routes
app.use('/admin', adminRoutes);

// Swagger Documentation
serveSwagger(app);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    code: 'not_found',
    message: 'Endpoint not found',
    correlationId: req.correlationId
  });
});

// Global error handler
app.use(errorHandler);

module.exports = app;

