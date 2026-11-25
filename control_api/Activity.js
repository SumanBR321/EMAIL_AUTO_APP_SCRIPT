/**
 * Activity.js — Control API Project
 * Centralized operational activity logging helper.
 */

var Activity = (function () {
  return {
    /**
     * Records an activity entry in the activity_log tab.
     */
    log: function (actorEmail, actorRole, actionCategory, action, targetType, targetId, details, status) {
      try {
        return Db.addActivity({
          actor_email: actorEmail || "system",
          actor_role: actorRole || "staff",
          action_category: actionCategory || "campaign",
          action: action,
          target_entity_type: targetType || "system",
          target_entity_id: targetId || "",
          details: details || {},
          status: status || "success"
        });
      } catch (err) {
        Logger.log("Activity.log failed: " + err.toString());
        return null;
      }
    }
  };
})();
