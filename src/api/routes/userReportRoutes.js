const express = require('express');
const router = express.Router();
const userReportController = require('../controllers/userReportController');
const authenticate = require('../middlewares/authenticate');
const requireCsrf = require('../middlewares/requireCsrf');
const { generalRateLimiter } = require('../middlewares/rateLimiter');
const validateRequest = require('../middlewares/validateRequest');
const { reportUserSchema } = require('../validation/userReportSchemas');
const Joi = require('joi');

const userIdParamSchema = Joi.object({
  userId: Joi.string()
    .pattern(/^[a-f\d]{24}$/i)
    .required()
    .messages({
      'string.pattern.base': 'userId must be a valid MongoDB ObjectId',
      'any.required': 'userId is required'
    })
}).options({ abortEarly: false });

/**
 * GET /users/me/reports-received
 * Get all reports made about the current user
 */
router.get(
  '/me/reports-received',
  authenticate,
  userReportController.getMyReportsReceived.bind(userReportController)
);

/**
 * POST /users/:userId/report
 * Report a user from a specific trip
 */
router.post(
  '/:userId/report',
  generalRateLimiter,
  authenticate,
  requireCsrf,
  validateRequest(userIdParamSchema, 'params'),
  validateRequest(reportUserSchema, 'body'),
  userReportController.reportUser.bind(userReportController)
);

module.exports = router;

