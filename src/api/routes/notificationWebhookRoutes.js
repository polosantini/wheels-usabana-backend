const express = require('express');
const router = express.Router();

const rawBodyMiddleware = require('../middlewares/rawBody');
const NotificationWebhookController = require('../controllers/notificationWebhookController');

const controller = new NotificationWebhookController();

/**
 * POST /notifications/webhooks/email
 * Public endpoint; signature-validated
 */
router.post('/email', rawBodyMiddleware, controller.handleEmailWebhook.bind(controller));

module.exports = router;
