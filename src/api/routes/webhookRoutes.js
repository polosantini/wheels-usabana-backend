/**
 * Webhook Routes (US-4.1.3)
 * 
 * Public webhook endpoints for payment providers.
 * 
 * CRITICAL:
 * - No authentication (public endpoint)
 * - Signature verification instead (shared secret)
 * - Raw body required for signature verification
 * - Must be mounted BEFORE express.json() in app.js
 */

const express = require('express');
const router = express.Router();

const WebhookController = require('../controllers/webhookController');
const rawBodyMiddleware = require('../middlewares/rawBody');

const webhookController = new WebhookController();

/**
 * @route   POST /payments/webhooks/stripe
 * @desc    Stripe webhook handler for payment events
 * @access  Public (signature-verified)
 */
/**
 * @openapi
 * /payments/webhooks/stripe:
 *   post:
 *     tags:
 *       - Webhooks
 *     summary: Stripe payment webhook (Public, signature-verified)
 *     description: |
 *       Receives webhook events from Stripe when payment status changes.
 *       
 *       **Security**: Verified using Stripe signature (STRIPE_WEBHOOK_SECRET)
 *       
 *       **Supported Events**:
 *       - `payment_intent.succeeded` → Transaction status: succeeded
 *       - `payment_intent.payment_failed` → Transaction status: failed
 *       - `payment_intent.canceled` → Transaction status: canceled
 *       - `payment_intent.processing` → Transaction status: processing
 *       
 *       **Idempotency**:
 *       - Events processed once by eventId
 *       - Duplicate events return 200 (already processed)
 *       
 *       **Error Handling**:
 *       - Invalid signature: 400 invalid_signature
 *       - Unknown payment intent: 200 (logged for investigation)
 *       - Application errors: 200 (prevents Stripe retries)
 *     parameters:
 *       - in: header
 *         name: Stripe-Signature
 *         required: true
 *         schema:
 *           type: string
 *         description: Stripe webhook signature for verification
 *         example: "t=1234567890,v1=abc123def456,v0=xyz789"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *                 description: Stripe event ID
 *                 example: "evt_1Qx3K2eZvKYlo2C0abc123"
 *               type:
 *                 type: string
 *                 enum:
 *                   - payment_intent.succeeded
 *                   - payment_intent.payment_failed
 *                   - payment_intent.canceled
 *                   - payment_intent.processing
 *                 example: "payment_intent.succeeded"
 *               data:
 *                 type: object
 *                 properties:
 *                   object:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         description: Stripe payment intent ID
 *                         example: "pi_3K1bXY2eZvKYlo2C0abc1234"
 *                       metadata:
 *                         type: object
 *                         description: Metadata attached during intent creation
 *                         properties:
 *                           bookingId:
 *                             type: string
 *                           tripId:
 *                             type: string
 *                           passengerId:
 *                             type: string
 *           examples:
 *             payment_succeeded:
 *               value:
 *                 id: "evt_1Qx3K2eZvKYlo2C0abc123"
 *                 type: "payment_intent.succeeded"
 *                 data:
 *                   object:
 *                     id: "pi_3K1bXY2eZvKYlo2C0abc1234"
 *                     amount: 50000
 *                     currency: "cop"
 *                     status: "succeeded"
 *                     metadata:
 *                       bookingId: "66b1c2d3e4f5a6b7c8d9e0f1"
 *                       tripId: "66a1b2c3d4e5f6a7b8c9d0e1"
 *             payment_failed:
 *               value:
 *                 id: "evt_1Qx3K3eZvKYlo2C0def456"
 *                 type: "payment_intent.payment_failed"
 *                 data:
 *                   object:
 *                     id: "pi_3K1bXY2eZvKYlo2C0abc1234"
 *                     last_payment_error:
 *                       code: "card_declined"
 *                       message: "Your card was declined"
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *             examples:
 *               success:
 *                 value:
 *                   ok: true
 *               already_processed:
 *                 value:
 *                   ok: true
 *       400:
 *         description: Invalid signature
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: "invalid_signature"
 *                 message:
 *                   type: string
 *                   example: "Webhook signature verification failed"
 */
router.post(
  '/webhooks/stripe',
  rawBodyMiddleware,
  webhookController.handleStripeWebhook.bind(webhookController)
);

module.exports = router;
