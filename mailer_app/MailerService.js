/**
 * MailerService.js — Mailer App Project
 * Two-phase commit email dispatching engine with HTML sanitization and compliance footer.
 */

var MailerService = (function () {
  /**
   * Prevents HTML injection in emails by escaping special characters.
   */
  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  /**
   * Generates a deterministic idempotency key for campaign and recipient.
   */
  function computeIdempotencyKey(campaignId, recipientEmail) {
    var raw = campaignId + ":" + recipientEmail.trim().toLowerCase();
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
    var hex = "";
    for (var i = 0; i < digest.length; i++) {
      var byteVal = digest[i] < 0 ? digest[i] + 256 : digest[i];
      var hexByte = byteVal.toString(16);
      hex += hexByte.length === 1 ? "0" + hexByte : hexByte;
    }
    return hex;
  }

  return {
    escapeHtml: escapeHtml,

    /**
     * Executes the Two-Phase Send for a single recipient.
     * 1. PHASE 1: Reserve recipient and acquire signed unsub link (/presend)
     * 2. DISPATCH: MailApp.sendEmail with sanitized template & compliance footer
     * 3. PHASE 2: Confirm delivery outcome (/log)
     */
    sendOneEmail: function (callerEmail, campaignId, recipient, subjectTemplate, bodyTemplate) {
      var normEmail = (recipient.email || "").trim().toLowerCase();
      var idempotencyKey = computeIdempotencyKey(campaignId, normEmail);

      // PHASE 1: Reserve recipient with ScriptLock at Control API
      var preResult = ApiClient.call("presend", callerEmail, {
        campaign_id: campaignId,
        recipient_email: normEmail,
        recipient_name: recipient.name || "",
        company_name: recipient.company || "",
        idempotency_key: idempotencyKey,
        subject: subjectTemplate
      });

      if (!preResult.ok) {
        return {
          ok: false,
          status: preResult.error || "blocked",
          message: preResult.message || "Email reservation rejected by Control API."
        };
      }

      var reservationData = preResult.data || {};
      var logId = reservationData.log_id;
      var unsubUrl = reservationData.unsub_url;
      var agencyName = reservationData.agency_name || "Apex Talent Partners";
      var agencyPostalAddress = reservationData.agency_postal_address || "";

      // Variable substitution with HTML escaping
      var safeName = escapeHtml(recipient.name || "");
      var safeCompany = escapeHtml(recipient.company || "Partner");

      var finalSubject = subjectTemplate
        .replaceAll("{{name}}", safeName)
        .replaceAll("{{company}}", safeCompany);

      var finalBodyHtml = bodyTemplate
        .replaceAll("{{name}}", safeName)
        .replaceAll("{{company}}", safeCompany);

      // Append standard CAN-SPAM / GDPR compliant footer
      var footerHtml = '<br><hr style="border:none;border-top:1px solid #E4E4E4;margin:28px 0 20px 0;">' +
        '<p style="font-size:12px;line-height:1.6;color:#878687;font-family:sans-serif;">' +
        'You received this notice regarding your vendor partnership with <strong>' + escapeHtml(agencyName) + '</strong>.<br>' +
        escapeHtml(agencyPostalAddress) + '<br>' +
        '<a href="' + unsubUrl + '" style="color:#E2653B;text-decoration:underline;">Unsubscribe from future outreach</a>' +
        '</p>';

      finalBodyHtml += footerHtml;

      var sendStatus = "sent";
      var errorMessage = "";

      try {
        MailApp.sendEmail({
          to: normEmail,
          subject: finalSubject,
          htmlBody: finalBodyHtml
        });
      } catch (sendErr) {
        sendStatus = "failed";
        errorMessage = sendErr.toString();
      }

      // PHASE 2: Confirm delivery outcome
      try {
        ApiClient.call("log", callerEmail, {
          log_id: logId,
          campaign_id: campaignId,
          recipient_email: normEmail,
          status: sendStatus,
          error_message: errorMessage
        });
      } catch (logErr) {
        Logger.log("Critical: Failed to confirm /log for " + logId + ": " + logErr.toString());
      }

      var remainingQuota = MailApp.getRemainingDailyQuota();
      if (remainingQuota <= 0) {
        try {
          ApiClient.call("activity/log", callerEmail, {
            action_category: "campaign",
            action: "quota_exhausted",
            target_entity_type: "campaign",
            target_entity_id: campaignId,
            details: { remaining_quota: 0 },
            status: "blocked"
          });
        } catch (e) {}
      }

      return {
        ok: sendStatus === "sent",
        status: sendStatus,
        remainingQuota: remainingQuota,
        errorMessage: errorMessage
      };
    }
  };
})();
