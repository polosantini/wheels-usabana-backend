const express = require('express');
const router = express.Router();

const ReviewController = require('../controllers/reviewController');
const validateRequest = require('../middlewares/validateRequest');
const authenticate = require('../middlewares/authenticate');
const { requireRole } = require('../middlewares/authenticate');
const requireCsrf = require('../middlewares/requireCsrf');
const { createReviewBodySchema } = require('../validation/reviewSchemas');

const controller = new ReviewController();

// POST /trips/:tripId/reviews - passenger writes a review for a completed trip
router.post(
  '/:tripId/reviews',
  authenticate,
  requireRole('passenger'),
  requireCsrf,
  validateRequest(createReviewBodySchema, 'body'),
  controller.createReview.bind(controller)
);

// Report a review: POST /reviews/:reviewId/report
router.post(
  '/reviews/:reviewId/report',
  authenticate,
  requireCsrf,
  validateRequest(require('../validation/reviewSchemas').reviewIdParamSchema, 'params'),
  validateRequest(require('../validation/reviewSchemas').reportReviewBodySchema, 'body'),
  controller.reportReview.bind(controller)
);

module.exports = router;
