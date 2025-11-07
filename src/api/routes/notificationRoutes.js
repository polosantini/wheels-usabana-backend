const express = require('express');
const router = express.Router();

const NotificationController = require('../controllers/notificationController');
const authenticate = require('../middlewares/authenticate');

const controller = new NotificationController();

/**
 * GET /notifications
 * Query: status=unread|all, page, pageSize
 */
router.get('/', authenticate, controller.list.bind(controller));

/**
 * PATCH /notifications/read
 * Body: { ids: [string] }
 */
router.patch('/read', authenticate, controller.markRead.bind(controller));

module.exports = router;
