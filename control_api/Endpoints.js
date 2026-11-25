/**
 * Endpoints.js — Control API Project
 * Request handlers implementing the full Control API specification.
 */

var Endpoints = (function () {
  var EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  return {
    /**
     * 10.1 /check — Verify Staff & Get Context
     */
    check: function (callerEmail, staffRecord, payload) {
      Activity.log(
        callerEmail,
        staffRecord.is_admin ? "admin" : "staff",
        "session",
        "session_start",
        "staff",
        callerEmail,
        { display_name: staffRecord.display_name },
        "success"
      );

      return {
        ok: true,
        data: {
          display_name: staffRecord.display_name,
          is_admin: staffRecord.is_admin,
          window_days: Config.getWindowDays(),
          agency_name: Config.getAgencyName(),
          agency_postal_address: Config.getAgencyPostalAddress()
        }
      };
    },

    /**
     * 10.2 /preview — Ingest & Clean Batch
     */
    preview: function (callerEmail, staffRecord, payload) {
      var campaignId = payload.campaign_id;
      var name = payload.name || "Untitled Campaign";
      var subject = payload.subject || "";
      var bodyTemplate = payload.body_template || "";
      var contacts = payload.contacts || [];

      if (!campaignId) {
        throw new Error("Missing campaign_id in preview payload.");
      }

      var windowDays = Config.getWindowDays();
      var cutoffTime = new Date().getTime() - windowDays * 24 * 60 * 60 * 1000;

      // Extract unique email addresses
      var emailList = [];
      for (var i = 0; i < contacts.length; i++) {
        var e = (contacts[i].email || "").trim().toLowerCase();
        if (e) emailList.push(e);
      }

      // Batch query contact states
      var stateMap = Db.getContactStatesBatch(emailList);

      var total = contacts.length;
      var valid = 0;
      var invalid = 0;
      var duplicate = 0;
      var suppressed = 0;
      var recentlyContacted = 0;
      var sendable = 0;

      var seenInBatch = {};
      var recipientsToSave = [];

      for (var j = 0; j < contacts.length; j++) {
        var c = contacts[j];
        var email = (c.email || "").trim().toLowerCase();
        var contactName = c.name ? String(c.name).trim() : "";
        var company = c.company ? String(c.company).trim() : "";

        if (!email || !EMAIL_REGEX.test(email)) {
          invalid++;
          recipientsToSave.push({ email: email || "invalid", name: contactName, company: company, status: "skipped" });
          continue;
        }

        if (seenInBatch[email]) {
          duplicate++;
          recipientsToSave.push({ email: email, name: contactName, company: company, status: "skipped" });
          continue;
        }
        seenInBatch[email] = true;
        valid++;

        var state = stateMap[email];
        if (state && state.is_suppressed) {
          suppressed++;
          recipientsToSave.push({ email: email, name: contactName, company: company, status: "skipped" });
          continue;
        }

        if (state && state.last_sent_at) {
          var sentTime = state.last_sent_at.getTime();
          if (sentTime > cutoffTime && (state.last_status === "sent" || state.last_status === "pending")) {
            recentlyContacted++;
            recipientsToSave.push({ email: email, name: contactName, company: company, status: "skipped" });
            continue;
          }
        }

        sendable++;
        recipientsToSave.push({ email: email, name: contactName, company: company, status: "queued" });
      }

      // Persist campaign state
      Db.upsertCampaign({
        campaign_id: campaignId,
        staff_email: callerEmail,
        name: name,
        subject: subject,
        body_template: bodyTemplate,
        total_count: total,
        sent_count: 0,
        failed_count: 0,
        status: "active"
      });

      // Save recipients list to sheet
      Db.saveCampaignRecipients(campaignId, recipientsToSave);

      // Log activity
      Activity.log(
        callerEmail,
        staffRecord.is_admin ? "admin" : "staff",
        "campaign",
        "contacts_previewed",
        "campaign",
        campaignId,
        {
          total: total,
          valid: valid,
          invalid: invalid,
          duplicate: duplicate,
          suppressed: suppressed,
          recently_contacted: recentlyContacted,
          sendable: sendable
        },
        "success"
      );

      return {
        ok: true,
        data: {
          total: total,
          valid: valid,
          invalid: invalid,
          duplicate: duplicate,
          suppressed: suppressed,
          recently_contacted: recentlyContacted,
          sendable: sendable
        }
      };
    },

    /**
     * 10.3 /presend — Two-Phase Commit Reservation
     */
    presend: function (callerEmail, staffRecord, payload) {
      var lock = LockService.getScriptLock();
      var lockAcquired = false;
      try {
        // Wait up to 10 seconds for script lock to serialize reservations
        lockAcquired = lock.tryLock(10000);
        if (!lockAcquired) {
          return {
            ok: false,
            error: "lock_timeout",
            message: "System is busy processing concurrent requests. Please retry."
          };
        }

        var campaignId = payload.campaign_id;
        var recipientEmail = (payload.recipient_email || "").trim().toLowerCase();
        var recipientName = payload.recipient_name || "";
        var companyName = payload.company_name || "";
        var idempotencyKey = payload.idempotency_key;

        if (!recipientEmail || !campaignId) {
          return { ok: false, error: "invalid_input", message: "Missing recipient_email or campaign_id." };
        }

        // Check idempotency first: if already logged as pending or sent, handle idempotency
        if (idempotencyKey) {
          var existingLog = Db.getSendLogByIdempotency(idempotencyKey);
          if (existingLog) {
            if (existingLog.status === "sent") {
              return {
                ok: false,
                error: "already_sent",
                message: "Email has already been sent to this recipient for this campaign."
              };
            }
          }
        }

        // 1. Check suppression
        var state = Db.getContactState(recipientEmail);
        if (state && state.is_suppressed) {
          Activity.log(callerEmail, "staff", "dispatch", "send_blocked", "recipient", recipientEmail, { reason: "suppressed" }, "blocked");
          return {
            ok: false,
            error: "suppressed",
            message: "Recipient is on the permanent suppression list."
          };
        }

        // Check suppression table as double fallback
        var supp = Db.getSuppression(recipientEmail);
        if (supp && supp.status === "active") {
          Activity.log(callerEmail, "staff", "dispatch", "send_blocked", "recipient", recipientEmail, { reason: "suppressed" }, "blocked");
          return {
            ok: false,
            error: "suppressed",
            message: "Recipient is actively suppressed."
          };
        }

        // 2. Check recent contact window
        var windowDays = Config.getWindowDays();
        var cutoffTime = new Date().getTime() - windowDays * 24 * 60 * 60 * 1000;
        if (state && state.last_sent_at) {
          var sentTime = state.last_sent_at.getTime();
          if (sentTime > cutoffTime && (state.last_status === "sent" || state.last_status === "pending")) {
            Activity.log(callerEmail, "staff", "dispatch", "send_blocked", "recipient", recipientEmail, { reason: "recently_contacted", last_sent_at: state.last_sent_at }, "blocked");
            return {
              ok: false,
              error: "recently_contacted",
              message: "Recipient was contacted by a colleague in the last " + windowDays + " days."
            };
          }
        }

        // 3. Generate Reservation IDs and HMAC Unsubscribe URL
        var logId = "log_" + Utilities.getUuid().replace(/-/g, "").substring(0, 12);
        var unsubToken = Auth.generateUnsubToken(recipientEmail);
        var baseUrl = Config.getControlApiUrl();
        var unsubUrl = baseUrl + (baseUrl.indexOf("?") === -1 ? "?" : "&") + "action=unsub&token=" + encodeURIComponent(unsubToken);

        // 4. Insert Pending row in send_log
        Db.insertPendingSendLog({
          log_id: logId,
          campaign_id: campaignId,
          idempotency_key: idempotencyKey || (campaignId + ":" + recipientEmail),
          staff_email: callerEmail,
          recipient_email: recipientEmail,
          recipient_name: recipientName,
          subject: payload.subject || "Outreach Notice"
        });

        // 5. Update contact_state to 'pending' to block concurrent senders
        Db.upsertContactState({
          email: recipientEmail,
          company_name: companyName,
          is_suppressed: false,
          last_sent_at: new Date(),
          last_status: "pending",
          last_campaign_id: campaignId,
          last_staff_email: callerEmail
        });

        // 6. Update recipient status in campaign_recipients
        Db.updateRecipientStatus(campaignId, recipientEmail, "pending", logId);

        // 7. Log reservation in activity_log
        Activity.log(callerEmail, "staff", "dispatch", "email_reserved", "recipient", recipientEmail, { log_id: logId, campaign_id: campaignId }, "success");

        return {
          ok: true,
          data: {
            proceed: true,
            log_id: logId,
            unsub_url: unsubUrl,
            agency_name: Config.getAgencyName(),
            agency_postal_address: Config.getAgencyPostalAddress()
          }
        };
      } finally {
        if (lockAcquired) {
          lock.releaseLock();
        }
      }
    },

    /**
     * 10.4 /log — Confirm Delivery Outcome
     */
    log: function (callerEmail, staffRecord, payload) {
      var lock = LockService.getScriptLock();
      var lockAcquired = false;
      try {
        lockAcquired = lock.tryLock(10000);
        if (!lockAcquired) {
          return {
            ok: false,
            error: "lock_timeout",
            message: "System is busy updating delivery logs. Please retry."
          };
        }

        var logId = payload.log_id;
        var campaignId = payload.campaign_id;
        var recipientEmail = (payload.recipient_email || "").trim().toLowerCase();
        var status = payload.status === "sent" ? "sent" : "failed";
        var errorMessage = payload.error_message || "";

        // Update send_log
        Db.updateSendLogOutcome(logId, status, errorMessage);

        // Update contact_state
        var contactState = Db.getContactState(recipientEmail);
        if (contactState) {
          Db.upsertContactState({
            email: recipientEmail,
            last_status: status,
            last_sent_at: status === "sent" ? new Date() : (contactState.last_sent_at || new Date())
          });
        }

        // Update campaign recipient
        if (campaignId) {
          Db.updateRecipientStatus(campaignId, recipientEmail, status, logId);
          // Update campaign counts
          Db.upsertCampaign({
            campaign_id: campaignId,
            sent_count: status === "sent" ? 1 : 0,
            failed_count: status === "failed" ? 1 : 0
          });
        }

        // Activity log
        Activity.log(
          callerEmail,
          staffRecord.is_admin ? "admin" : "staff",
          "dispatch",
          status === "sent" ? "email_sent" : "email_failed",
          "recipient",
          recipientEmail,
          { log_id: logId, error: errorMessage },
          status === "sent" ? "success" : "failure"
        );

        return {
          ok: true,
          data: {
            log_id: logId,
            updated: true
          }
        };
      } finally {
        if (lockAcquired) {
          lock.releaseLock();
        }
      }
    },

    /**
     * 10.5 /activity/log — Record Client Operational Events
     */
    activityLog: function (callerEmail, staffRecord, payload) {
      var actId = Activity.log(
        callerEmail,
        staffRecord.is_admin ? "admin" : "staff",
        payload.action_category || "campaign",
        payload.action,
        payload.target_entity_type || "campaign",
        payload.target_entity_id || "",
        payload.details || payload.details_json || {},
        payload.status || "success"
      );

      return {
        ok: true,
        data: {
          activity_id: actId
        }
      };
    },

    /**
     * 10.6 /activity/list — Retrieve Activity Log (Admin Only)
     */
    activityList: function (callerEmail, staffRecord, payload) {
      if (!staffRecord.is_admin) {
        throw new Error("Admin privilege required for viewing global activity logs.");
      }

      var limit = payload.limit ? parseInt(payload.limit, 10) : 100;
      var offset = payload.offset ? parseInt(payload.offset, 10) : 0;
      var filterActor = payload.filter_actor || "";
      var filterCategory = payload.filter_category || "";

      var result = Db.listActivities(limit, offset, filterActor, filterCategory);

      return {
        ok: true,
        data: result
      };
    },

    /**
     * 10.7 /unsuppress — Lift Suppression (Admin Only)
     */
    unsuppress: function (callerEmail, staffRecord, payload) {
      if (!staffRecord.is_admin) {
        throw new Error("Admin privilege required to lift suppression.");
      }

      var email = (payload.email || "").trim().toLowerCase();
      var reason = (payload.reason || "").trim();

      if (!reason || reason.length < 10) {
        throw new Error("A written justification of at least 10 characters is required.");
      }

      Db.liftSuppression(email, callerEmail, reason);

      Activity.log(
        callerEmail,
        "admin",
        "admin",
        "suppress_lifted",
        "recipient",
        email,
        { reason: reason },
        "success"
      );

      return {
        ok: true,
        data: {
          email: email,
          status: "lifted"
        }
      };
    }
  };
})();
