const NotificationMetric = require('../../infrastructure/database/models/NotificationMetricModel');

function toDateKey(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0,10);
}

class NotificationMetricsService {
  async increment({ type, channel, date = new Date(), deltas = {} }) {
    const dateKey = toDateKey(date);
    if (!dateKey) return;

    const inc = {};
    for (const [k,v] of Object.entries(deltas)) {
      if (v && typeof v === 'number') inc[k] = v;
    }

    if (Object.keys(inc).length === 0) return;

    try {
      await NotificationMetric.findOneAndUpdate(
        { date: dateKey, type, channel },
        { $inc: inc },
        { upsert: true, new: true }
      );
    } catch (e) {
      console.error('[NotificationMetrics] increment error', e);
    }
  }

  async queryRange(from, to) {
    const fromKey = toDateKey(from);
    const toKey = toDateKey(to);
    if (!fromKey || !toKey) return { range: null, items: [] };

    const items = await NotificationMetric.aggregate([
      { $match: { date: { $gte: fromKey, $lte: toKey } } },
      { $group: {
          _id: { type: '$type', channel: '$channel' },
          rendered: { $sum: '$rendered' },
          attempted: { $sum: '$attempted' },
          delivered: { $sum: '$delivered' },
          bounced: { $sum: '$bounced' },
          complained: { $sum: '$complained' },
          skippedByPreferences: { $sum: '$skippedByPreferences' }
      } },
      { $project: {
          _id: 0,
          type: '$_id.type',
          channel: '$_id.channel',
          rendered: 1,
          attempted: 1,
          delivered: 1,
          bounced: 1,
          complained: 1,
          skippedByPreferences: 1
      } }
    ]).exec();

    return { range: { from: fromKey, to: toKey }, items };
  }
}

module.exports = new NotificationMetricsService();
