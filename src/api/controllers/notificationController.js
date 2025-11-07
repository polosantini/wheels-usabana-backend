const InAppNotification = require('../../infrastructure/database/models/InAppNotificationModel');
const Joi = require('joi');

class NotificationController {
  constructor() {}

  // GET /notifications
  async list(req, res) {
    try {
      const schema = Joi.object({
        status: Joi.string().valid('unread', 'all').default('all'),
        page: Joi.number().integer().min(1).default(1),
        pageSize: Joi.number().integer().min(1).max(50).default(10)
      });

      const { error, value } = schema.validate(req.query);
      if (error) {
        const details = error.details.map(d => ({ field: d.path.join('.'), issue: d.message }));
        return res.status(400).json({ code: 'invalid_schema', message: 'Validation failed', details, correlationId: req.correlationId });
      }

      const { status, page, pageSize } = value;

      const query = { userId: req.user.id };
      if (status === 'unread') query.isRead = false;

      const total = await InAppNotification.countDocuments(query);
      const totalPages = Math.ceil(total / pageSize) || 1;

      const items = await InAppNotification.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean();

      // Shape response
      const shaped = items.map(i => ({
        id: i._id.toString(),
        type: i.type,
        title: i.title,
        body: i.body,
        data: i.data || {},
        isRead: !!i.isRead,
        createdAt: i.createdAt
      }));

      return res.json({ items: shaped, page, pageSize, total, totalPages });
    } catch (err) {
      console.error('[NotificationController.list] Error:', err);
      return res.status(500).json({ code: 'internal_error', message: 'Internal server error', correlationId: req.correlationId });
    }
  }

  // PATCH /notifications/read
  async markRead(req, res) {
    try {
      const schema = Joi.object({ ids: Joi.array().items(Joi.string().required()).required() });
      const { error, value } = schema.validate(req.body);
      if (error) {
        const details = error.details.map(d => ({ field: d.path.join('.'), issue: d.message }));
        return res.status(400).json({ code: 'invalid_schema', message: 'Validation failed', details, correlationId: req.correlationId });
      }

      const ids = value.ids;

      // Update only notifications owned by the caller and not already read
      const result = await InAppNotification.updateMany(
        { _id: { $in: ids }, userId: req.user.id, isRead: false },
        { $set: { isRead: true } }
      );

      // Mongoose 6+ returns modifiedCount
      const updated = result.modifiedCount != null ? result.modifiedCount : (result.nModified || 0);

      return res.json({ updated });
    } catch (err) {
      console.error('[NotificationController.markRead] Error:', err);
      return res.status(500).json({ code: 'internal_error', message: 'Internal server error', correlationId: req.correlationId });
    }
  }
}

module.exports = NotificationController;
