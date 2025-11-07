/**
 * Notification preferences metadata and guardrails
 *
 * Export a map of critical notification types and which channels are locked
 * (non-editable) for safety. Clients can call the metadata endpoint to discover
 * which event/channel pairs cannot be disabled.
 */

const locked = {
  // Prevent users from disabling email for payment failures — critical alert
  'payment.failed': { email: true },
  // Prevent disabling email for payment succeeded? keep flexible — example only
  // Add more entries as product requirements evolve
};

function isLocked(type, channel) {
  if (!locked[type]) return false;
  return !!locked[type][channel];
}

module.exports = { locked, isLocked };
