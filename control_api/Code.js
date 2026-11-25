/**
 * Code.js — Control API Project
 * HTTP Request Routers: doGet and doPost handlers.
 */

/**
 * HTTP GET Handler.
 * Serves the public bot-resistant unsubscribe confirmation page or health status.
 */
function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  var action = params.action;

  // Handle Unsubscribe confirmation page
  if (action === "unsub") {
    var token = params.token;
    var verifyResult = Auth.verifyUnsubToken(token);

    var template = HtmlService.createTemplateFromFile("Unsubscribe");
    template.agencyName = Config.getAgencyName();
    template.agencyPostalAddress = Config.getAgencyPostalAddress();
    template.formActionUrl = Config.getControlApiUrl() || ScriptApp.getService().getUrl();

    if (verifyResult.valid) {
      Activity.log(
        verifyResult.email,
        "recipient",
        "compliance",
        "unsub_page_viewed",
        "recipient",
        verifyResult.email,
        { token_valid: true },
        "success"
      );

      template.view = "confirm";
      template.pageTitle = "Confirm Unsubscribe — " + Config.getAgencyName();
      template.recipientEmail = verifyResult.email;
      template.token = token;
      template.errorMessage = "";
    } else {
      Activity.log(
        verifyResult.email || "unknown",
        "recipient",
        "compliance",
        "unsub_invalid_token",
        "recipient",
        verifyResult.email || "unknown",
        { error: verifyResult.error },
        "failure"
      );

      template.view = "error";
      template.pageTitle = "Invalid Unsubscribe Link — " + Config.getAgencyName();
      template.recipientEmail = "";
      template.token = "";
      template.errorMessage = verifyResult.error === "Token has expired"
        ? "This unsubscribe link has expired (links remain valid for 365 days). Please reply directly with STOP to any of our emails to be removed."
        : "This unsubscribe link is invalid or incomplete. Please reply directly with STOP to any of our emails to be removed.";
    }

    return template.evaluate()
      .setTitle(template.pageTitle)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DENY);
  }

  // Health check response
  return ContentService.createTextOutput(JSON.stringify({
    ok: true,
    service: "Vendor Outreach Control API",
    status: "online",
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * HTTP POST Handler.
 * Authenticates shared secret and dispatches to appropriate endpoint.
 */
function doPost(e) {
  var contentType = (e && e.postData && e.postData.type) || "";
  var rawContent = (e && e.postData && e.postData.contents) || "";
  var formParams = e && e.parameter ? e.parameter : {};

  // Check if this is a form POST submission from the Unsubscribe confirmation page
  var action = formParams.action;
  var token = formParams.token;

  if (action === "unsub_confirm" || (contentType.indexOf("application/x-www-form-urlencoded") !== -1 && formParams.action === "unsub_confirm")) {
    var verifyResult = Auth.verifyUnsubToken(token);
    var template = HtmlService.createTemplateFromFile("Unsubscribe");
    template.agencyName = Config.getAgencyName();
    template.agencyPostalAddress = Config.getAgencyPostalAddress();
    template.formActionUrl = Config.getControlApiUrl() || ScriptApp.getService().getUrl();

    if (verifyResult.valid) {
      var email = verifyResult.email;
      Db.addSuppression({
        email: email,
        reason: "unsubscribe",
        source: "recipient_link",
        created_by: "system"
      });

      Activity.log(
        email,
        "recipient",
        "compliance",
        "unsub_confirmed",
        "recipient",
        email,
        { source: "recipient_link" },
        "success"
      );

      template.view = "success";
      template.pageTitle = "Unsubscribed — " + Config.getAgencyName();
      template.recipientEmail = email;
      template.token = "";
      template.errorMessage = "";
    } else {
      template.view = "error";
      template.pageTitle = "Invalid Unsubscribe Request";
      template.recipientEmail = "";
      template.token = "";
      template.errorMessage = "Unable to process unsubscribe: invalid or expired token.";
    }

    return template.evaluate()
      .setTitle(template.pageTitle)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DENY);
  }

  // Authenticated JSON API Endpoints
  var req;
  try {
    req = JSON.parse(rawContent);
  } catch (err) {
    return jsonResponse(false, "Invalid JSON payload: " + err.message, 400);
  }

  var incomingSecret = req.secret;
  var reqAction = req.action;
  var callerEmail = (req.caller_email || "").trim().toLowerCase();
  var payload = req.payload || {};

  // 1. Verify Shared Secret
  if (!Auth.verifySharedSecret(incomingSecret)) {
    Activity.log(
      callerEmail || "unknown",
      "unauthenticated",
      "session",
      "access_denied",
      "system",
      "control_api",
      { reason: "invalid_shared_secret" },
      "blocked"
    );
    return jsonResponse(false, "Unauthorized: Invalid shared secret.", 401);
  }

  // 2. Verify Staff Allowlist
  var staffRecord;
  try {
    staffRecord = Auth.verifyStaff(callerEmail);
  } catch (err) {
    Activity.log(
      callerEmail || "unknown",
      "unauthenticated",
      "session",
      "access_denied",
      "staff",
      callerEmail || "unknown",
      { reason: err.message },
      "blocked"
    );
    return jsonResponse(false, "Access Denied: " + err.message, 403);
  }

  // 3. Dispatch to Endpoints
  try {
    var result;
    switch (reqAction) {
      case "check":
        result = Endpoints.check(callerEmail, staffRecord, payload);
        break;
      case "preview":
        result = Endpoints.preview(callerEmail, staffRecord, payload);
        break;
      case "presend":
        result = Endpoints.presend(callerEmail, staffRecord, payload);
        break;
      case "log":
        result = Endpoints.log(callerEmail, staffRecord, payload);
        break;
      case "activity/log":
        result = Endpoints.activityLog(callerEmail, staffRecord, payload);
        break;
      case "activity/list":
        result = Endpoints.activityList(callerEmail, staffRecord, payload);
        break;
      case "unsuppress":
        result = Endpoints.unsuppress(callerEmail, staffRecord, payload);
        break;
      default:
        return jsonResponse(false, "Unknown action: " + reqAction, 404);
    }
    return jsonResponse(result.ok !== false, result.message || "", 200, result.data || result);
  } catch (err) {
    Logger.log("Error handling action " + reqAction + ": " + err.toString());
    return jsonResponse(false, err.message || "Internal server error.", 500);
  }
}

/**
 * Formats a standardized JSON response envelope.
 */
function jsonResponse(ok, message, statusCode, data) {
  var output = {
    ok: ok,
    status_code: statusCode || 200,
    message: message || (ok ? "Success" : "Error")
  };
  if (data !== undefined) {
    output.data = data;
  }
  return ContentService.createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}
