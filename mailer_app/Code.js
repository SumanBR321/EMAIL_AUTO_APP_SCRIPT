/**
 * Code.js — Mailer App Project
 * Public server functions callable via google.script.run from the web browser.
 * Note: Staff identity is strictly derived on the server via Session.getActiveUser().getEmail().
 */

/**
 * Entry point. Serves the Mailer single-page application.
 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile("index")
    .setTitle("Vendor Outreach Portal")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DENY);
}

/**
 * Helper: Records an operational user activity event.
 */
function recordActivity(actionCategory, action, targetType, targetId, detailsObj, status) {
  var callerEmail = Session.getActiveUser().getEmail().trim().toLowerCase();
  try {
    ApiClient.call("activity/log", callerEmail, {
      action_category: actionCategory,
      action: action,
      target_entity_type: targetType,
      target_entity_id: targetId,
      details: detailsObj || {},
      status: status || "success"
    });
  } catch (err) {
    Logger.log("recordActivity non-blocking warning: " + err.toString());
  }
}

/**
 * Verifies staff identity and returns user metadata, daily quota, and agency config.
 */
function getStaffContext() {
  var callerEmail = Session.getActiveUser().getEmail().trim().toLowerCase();
  if (!callerEmail) {
    throw new Error("Unable to resolve Google account identity. Please ensure you are logged into your Google account.");
  }

  var response = ApiClient.call("check", callerEmail, {});
  if (!response.ok) {
    throw new Error(response.message || "Authorization failed.");
  }

  var remainingQuota = MailApp.getRemainingDailyQuota();
  return {
    callerEmail: callerEmail,
    displayName: response.data.display_name,
    isAdmin: response.data.is_admin,
    remainingQuota: remainingQuota,
    windowDays: response.data.window_days,
    agencyName: response.data.agency_name,
    agencyPostalAddress: response.data.agency_postal_address
  };
}

/**
 * Ingests contacts, deduplicates locally, and runs cleaning preview via Control API.
 */
function previewContacts(campaignId, campaignName, subject, bodyTemplate, rawContacts) {
  var callerEmail = Session.getActiveUser().getEmail().trim().toLowerCase();
  if (!callerEmail) throw new Error("Unauthenticated session.");

  // Deduplicate locally within the uploaded batch
  var seen = {};
  var cleaned = [];
  for (var i = 0; i < rawContacts.length; i++) {
    var c = rawContacts[i];
    var email = (c.email || "").trim().toLowerCase();
    if (email && !seen[email]) {
      seen[email] = true;
      cleaned.push({
        email: email,
        name: c.name ? String(c.name).trim() : "",
        company: c.company ? String(c.company).trim() : ""
      });
    }
  }

  var response = ApiClient.call("preview", callerEmail, {
    campaign_id: campaignId,
    name: campaignName,
    subject: subject,
    body_template: bodyTemplate,
    contacts: cleaned
  });

  if (!response.ok) {
    throw new Error(response.message || "Preview validation failed.");
  }

  return response.data;
}

/**
 * Signals campaign state changes (start, pause, resume, completed) and logs activity.
 */
function setCampaignState(campaignId, action, details) {
  var callerEmail = Session.getActiveUser().getEmail().trim().toLowerCase();
  recordActivity("campaign", "campaign_" + action, "campaign", campaignId, details || {}, "success");
  return { ok: true, campaignId: campaignId, state: action };
}

/**
 * Executes two-phase send for a single contact.
 */
function sendOneEmail(campaignId, recipient, subjectTemplate, bodyTemplate) {
  var callerEmail = Session.getActiveUser().getEmail().trim().toLowerCase();
  if (!callerEmail) throw new Error("Unauthenticated session.");

  return MailerService.sendOneEmail(callerEmail, campaignId, recipient, subjectTemplate, bodyTemplate);
}

/**
 * Admin action: fetches global activity log entries.
 */
function getGlobalActivityLog(limit, offset, filterActor, filterCategory) {
  var callerEmail = Session.getActiveUser().getEmail().trim().toLowerCase();
  if (!callerEmail) throw new Error("Unauthenticated session.");

  var response = ApiClient.call("activity/list", callerEmail, {
    limit: limit || 100,
    offset: offset || 0,
    filter_actor: filterActor || "",
    filter_category: filterCategory || ""
  });

  if (!response.ok) {
    throw new Error(response.message || "Failed to retrieve activity log.");
  }

  return response.data;
}

/**
 * Admin action: lifts suppression. Enforces admin rights server-side.
 */
function adminUnsuppress(targetEmail, reason) {
  var callerEmail = Session.getActiveUser().getEmail().trim().toLowerCase();
  if (!callerEmail) throw new Error("Unauthenticated session.");

  if (!reason || reason.trim().length < 10) {
    throw new Error("A written justification of at least 10 characters is required.");
  }

  var response = ApiClient.call("unsuppress", callerEmail, {
    email: targetEmail.trim().toLowerCase(),
    reason: reason.trim()
  });

  if (!response.ok) {
    throw new Error(response.message || "Failed to lift suppression.");
  }

  return response.data;
}
