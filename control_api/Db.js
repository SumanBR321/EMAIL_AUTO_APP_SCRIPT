/**
 * Db.js — Control API Project
 * Spreadsheet Data Access Layer managing the 8 relational tabs.
 */

var Db = (function () {
  var TAB_NAMES = {
    CONTACT_STATE: "contact_state",
    SUPPRESSION: "suppression",
    SEND_LOG: "send_log",
    CAMPAIGNS: "campaigns",
    CAMPAIGN_RECIPIENTS: "campaign_recipients",
    STAFF: "staff",
    AUDIT_LOG: "audit_log",
    ACTIVITY_LOG: "activity_log"
  };

  var SCHEMAS = {
    contact_state: [
      "email", "company_name", "is_suppressed", "suppression_reason",
      "last_sent_at", "last_status", "last_campaign_id", "last_staff_email", "updated_at"
    ],
    suppression: [
      "email", "status", "reason", "source", "created_at",
      "created_by", "lifted_reason", "lifted_at", "lifted_by", "notes"
    ],
    send_log: [
      "log_id", "campaign_id", "idempotency_key", "staff_email", "recipient_email",
      "recipient_name", "subject", "status", "error_message", "created_at", "completed_at"
    ],
    campaigns: [
      "campaign_id", "staff_email", "name", "subject", "body_template",
      "total_count", "sent_count", "failed_count", "status", "created_at", "updated_at"
    ],
    campaign_recipients: [
      "item_id", "campaign_id", "recipient_email", "recipient_name",
      "company_name", "status", "log_id", "updated_at"
    ],
    staff: [
      "email", "display_name", "is_active", "is_admin", "added_at", "added_by"
    ],
    audit_log: [
      "audit_id", "admin_email", "action", "target_identifier", "reason", "created_at"
    ],
    activity_log: [
      "activity_id", "timestamp", "actor_email", "actor_role", "action_category",
      "action", "target_entity_type", "target_entity_id", "details_json", "status"
    ]
  };

  /**
   * Opens the configured Google Spreadsheet.
   * @return {GoogleAppsScript.Spreadsheet.Spreadsheet}
   */
  function getSpreadsheet() {
    var id = Config.getSpreadsheetId();
    if (!id) {
      throw new Error("Spreadsheet ID is not configured in ScriptProperties (SPREADSHEET_ID).");
    }
    return SpreadsheetApp.openById(id);
  }

  /**
   * Retrieves or creates a specific sheet tab.
   * @param {string} tabName
   * @return {GoogleAppsScript.Spreadsheet.Sheet}
   */
  function getSheet(tabName) {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      var headers = SCHEMAS[tabName];
      if (headers) {
        sheet.appendRow(headers);
        sheet.setFrozenRows(1);
      }
    }
    return sheet;
  }

  /**
   * Helper to convert 2D array of sheet data into an array of objects.
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @return {{ rows: Array<Object>, headers: Array<string> }}
   */
  function getSheetData(sheet) {
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 1 || lastCol < 1) return { rows: [], headers: [] };

    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    if (values.length <= 1) return { rows: [], headers: values[0] || [] };

    var headers = values[0].map(function (h) {
      return String(h).trim();
    });
    var rows = [];

    for (var i = 1; i < values.length; i++) {
      var rowObj = { _rowIndex: i + 1 }; // 1-based index in Sheet
      var row = values[i];
      for (var j = 0; j < headers.length; j++) {
        rowObj[headers[j]] = row[j];
      }
      rows.push(rowObj);
    }
    return { rows: rows, headers: headers };
  }

  return {
    TAB_NAMES: TAB_NAMES,
    SCHEMAS: SCHEMAS,
    getSheet: getSheet,
    getSpreadsheet: getSpreadsheet,

    // ==========================================
    // STAFF
    // ==========================================
    getStaff: function (email) {
      if (!email) return null;
      var norm = email.trim().toLowerCase();
      var sheet = getSheet(TAB_NAMES.STAFF);
      var data = getSheetData(sheet);
      for (var i = 0; i < data.rows.length; i++) {
        var r = data.rows[i];
        if (String(r.email).trim().toLowerCase() === norm) {
          return {
            email: norm,
            display_name: r.display_name || "",
            is_active: r.is_active === true || String(r.is_active).toUpperCase() === "TRUE",
            is_admin: r.is_admin === true || String(r.is_admin).toUpperCase() === "TRUE",
            added_at: r.added_at,
            added_by: r.added_by
          };
        }
      }
      return null;
    },

    // ==========================================
    // CONTACT STATE (FAST INDEX)
    // ==========================================
    getContactState: function (email) {
      if (!email) return null;
      var norm = email.trim().toLowerCase();
      var sheet = getSheet(TAB_NAMES.CONTACT_STATE);
      var data = getSheetData(sheet);
      for (var i = 0; i < data.rows.length; i++) {
        var r = data.rows[i];
        if (String(r.email).trim().toLowerCase() === norm) {
          return {
            _rowIndex: r._rowIndex,
            email: norm,
            company_name: r.company_name || "",
            is_suppressed: r.is_suppressed === true || String(r.is_suppressed).toUpperCase() === "TRUE",
            suppression_reason: r.suppression_reason || "",
            last_sent_at: r.last_sent_at ? new Date(r.last_sent_at) : null,
            last_status: r.last_status || "",
            last_campaign_id: r.last_campaign_id || "",
            last_staff_email: r.last_staff_email || "",
            updated_at: r.updated_at
          };
        }
      }
      return null;
    },

    /**
     * Efficiently fetches contact state records for a whole batch.
     * @param {Array<string>} emailList
     * @return {Object.<string, Object>} Map of lowercased email -> contactState
     */
    getContactStatesBatch: function (emailList) {
      var map = {};
      if (!emailList || emailList.length === 0) return map;

      var targetSet = {};
      for (var k = 0; k < emailList.length; k++) {
        if (emailList[k]) targetSet[emailList[k].trim().toLowerCase()] = true;
      }

      var sheet = getSheet(TAB_NAMES.CONTACT_STATE);
      var data = getSheetData(sheet);
      for (var i = 0; i < data.rows.length; i++) {
        var r = data.rows[i];
        var e = String(r.email).trim().toLowerCase();
        if (targetSet[e]) {
          map[e] = {
            _rowIndex: r._rowIndex,
            email: e,
            company_name: r.company_name || "",
            is_suppressed: r.is_suppressed === true || String(r.is_suppressed).toUpperCase() === "TRUE",
            suppression_reason: r.suppression_reason || "",
            last_sent_at: r.last_sent_at ? new Date(r.last_sent_at) : null,
            last_status: r.last_status || "",
            last_campaign_id: r.last_campaign_id || "",
            last_staff_email: r.last_staff_email || "",
            updated_at: r.updated_at
          };
        }
      }
      return map;
    },

    upsertContactState: function (state) {
      var norm = state.email.trim().toLowerCase();
      var sheet = getSheet(TAB_NAMES.CONTACT_STATE);
      var existing = this.getContactState(norm);
      var now = new Date().toISOString();

      var isSuppressed = state.is_suppressed === true ? "TRUE" : "FALSE";
      var lastSentAt = state.last_sent_at instanceof Date ? state.last_sent_at.toISOString() : (state.last_sent_at || "");

      if (existing) {
        var rowIdx = existing._rowIndex;
        // Columns: email (1), company_name (2), is_suppressed (3), suppression_reason (4),
        // last_sent_at (5), last_status (6), last_campaign_id (7), last_staff_email (8), updated_at (9)
        var rowValues = [
          norm,
          state.company_name || existing.company_name || "",
          state.is_suppressed !== undefined ? isSuppressed : (existing.is_suppressed ? "TRUE" : "FALSE"),
          state.suppression_reason !== undefined ? (state.suppression_reason || "") : existing.suppression_reason,
          state.last_sent_at !== undefined ? lastSentAt : (existing.last_sent_at ? existing.last_sent_at.toISOString() : ""),
          state.last_status !== undefined ? (state.last_status || "") : existing.last_status,
          state.last_campaign_id !== undefined ? (state.last_campaign_id || "") : existing.last_campaign_id,
          state.last_staff_email !== undefined ? (state.last_staff_email || "") : existing.last_staff_email,
          now
        ];
        sheet.getRange(rowIdx, 1, 1, rowValues.length).setValues([rowValues]);
      } else {
        sheet.appendRow([
          norm,
          state.company_name || "",
          isSuppressed,
          state.suppression_reason || "",
          lastSentAt,
          state.last_status || "",
          state.last_campaign_id || "",
          state.last_staff_email || "",
          now
        ]);
      }
    },

    // ==========================================
    // SUPPRESSION
    // ==========================================
    getSuppression: function (email) {
      if (!email) return null;
      var norm = email.trim().toLowerCase();
      var sheet = getSheet(TAB_NAMES.SUPPRESSION);
      var data = getSheetData(sheet);
      for (var i = 0; i < data.rows.length; i++) {
        var r = data.rows[i];
        if (String(r.email).trim().toLowerCase() === norm) {
          return {
            _rowIndex: r._rowIndex,
            email: norm,
            status: r.status || "active",
            reason: r.reason || "",
            source: r.source || "",
            created_at: r.created_at,
            created_by: r.created_by,
            lifted_reason: r.lifted_reason || "",
            lifted_at: r.lifted_at || "",
            lifted_by: r.lifted_by || "",
            notes: r.notes || ""
          };
        }
      }
      return null;
    },

    addSuppression: function (rec) {
      var norm = rec.email.trim().toLowerCase();
      var sheet = getSheet(TAB_NAMES.SUPPRESSION);
      var existing = this.getSuppression(norm);
      var now = new Date().toISOString();

      if (existing) {
        // If row exists, update to active
        sheet.getRange(existing._rowIndex, 2, 1, 4).setValues([[
          "active",
          rec.reason || "unsubscribe",
          rec.source || "recipient_link",
          existing.created_at || now
        ]]);
      } else {
        sheet.appendRow([
          norm,
          "active",
          rec.reason || "unsubscribe",
          rec.source || "recipient_link",
          now,
          rec.created_by || "system",
          "", // lifted_reason
          "", // lifted_at
          "", // lifted_by
          rec.notes || ""
        ]);
      }

      // Also sync contact_state
      this.upsertContactState({
        email: norm,
        is_suppressed: true,
        suppression_reason: rec.reason || "unsubscribe"
      });
    },

    liftSuppression: function (email, adminEmail, reason) {
      var norm = email.trim().toLowerCase();
      var sheet = getSheet(TAB_NAMES.SUPPRESSION);
      var existing = this.getSuppression(norm);
      var now = new Date().toISOString();

      if (!existing) {
        throw new Error("No suppression record found for: " + norm);
      }

      // Columns: email (1), status (2), reason (3), source (4), created_at (5),
      // created_by (6), lifted_reason (7), lifted_at (8), lifted_by (9), notes (10)
      sheet.getRange(existing._rowIndex, 2).setValue("lifted");
      sheet.getRange(existing._rowIndex, 7, 1, 3).setValues([[
        reason,
        now,
        adminEmail
      ]]);

      // Update contact_state
      this.upsertContactState({
        email: norm,
        is_suppressed: false,
        suppression_reason: ""
      });

      // Audit log entry
      this.addAuditLog({
        admin_email: adminEmail,
        action: "suppress_lifted",
        target_identifier: norm,
        reason: reason
      });
    },

    // ==========================================
    // SEND LOG (TRANSACTIONAL AUDIT)
    // ==========================================
    insertPendingSendLog: function (entry) {
      var sheet = getSheet(TAB_NAMES.SEND_LOG);
      var now = new Date().toISOString();
      sheet.appendRow([
        entry.log_id,
        entry.campaign_id,
        entry.idempotency_key,
        entry.staff_email.trim().toLowerCase(),
        entry.recipient_email.trim().toLowerCase(),
        entry.recipient_name || "",
        entry.subject || "",
        "pending",
        "",
        now,
        ""
      ]);
    },

    updateSendLogOutcome: function (logId, status, errorMessage) {
      var sheet = getSheet(TAB_NAMES.SEND_LOG);
      var data = getSheetData(sheet);
      var now = new Date().toISOString();

      for (var i = 0; i < data.rows.length; i++) {
        var r = data.rows[i];
        if (String(r.log_id).trim() === logId) {
          var rowIdx = r._rowIndex;
          // status is col 8, error_message is col 9, completed_at is col 11
          sheet.getRange(rowIdx, 8).setValue(status);
          sheet.getRange(rowIdx, 9).setValue(errorMessage || "");
          sheet.getRange(rowIdx, 11).setValue(now);
          return true;
        }
      }
      return false;
    },

    getSendLogById: function (logId) {
      var sheet = getSheet(TAB_NAMES.SEND_LOG);
      var data = getSheetData(sheet);
      for (var i = 0; i < data.rows.length; i++) {
        var r = data.rows[i];
        if (String(r.log_id).trim() === logId) return r;
      }
      return null;
    },

    getSendLogByIdempotency: function (idempotencyKey) {
      var sheet = getSheet(TAB_NAMES.SEND_LOG);
      var data = getSheetData(sheet);
      for (var i = 0; i < data.rows.length; i++) {
        var r = data.rows[i];
        if (String(r.idempotency_key).trim() === idempotencyKey) return r;
      }
      return null;
    },

    // ==========================================
    // CAMPAIGNS & CAMPAIGN RECIPIENTS
    // ==========================================
    upsertCampaign: function (c) {
      var sheet = getSheet(TAB_NAMES.CAMPAIGNS);
      var data = getSheetData(sheet);
      var now = new Date().toISOString();

      for (var i = 0; i < data.rows.length; i++) {
        var r = data.rows[i];
        if (String(r.campaign_id).trim() === c.campaign_id) {
          var rowIdx = r._rowIndex;
          // campaigns: campaign_id, staff_email, name, subject, body_template,
          // total_count, sent_count, failed_count, status, created_at, updated_at
          sheet.getRange(rowIdx, 3, 1, 7).setValues([[
            c.name || r.name,
            c.subject || r.subject,
            c.body_template || r.body_template,
            c.total_count !== undefined ? c.total_count : r.total_count,
            c.sent_count !== undefined ? c.sent_count : r.sent_count,
            c.failed_count !== undefined ? c.failed_count : r.failed_count,
            c.status || r.status
          ]]);
          sheet.getRange(rowIdx, 11).setValue(now);
          return;
        }
      }

      sheet.appendRow([
        c.campaign_id,
        c.staff_email.trim().toLowerCase(),
        c.name || "",
        c.subject || "",
        c.body_template || "",
        c.total_count || 0,
        c.sent_count || 0,
        c.failed_count || 0,
        c.status || "draft",
        now,
        now
      ]);
    },

    saveCampaignRecipients: function (campaignId, recipients) {
      if (!recipients || recipients.length === 0) return;
      var sheet = getSheet(TAB_NAMES.CAMPAIGN_RECIPIENTS);
      var now = new Date().toISOString();

      // Batch append
      var rows = [];
      for (var i = 0; i < recipients.length; i++) {
        var rec = recipients[i];
        var normEmail = rec.email.trim().toLowerCase();
        var itemId = campaignId + ":" + normEmail;
        rows.push([
          itemId,
          campaignId,
          normEmail,
          rec.name || "",
          rec.company || "",
          rec.status || "queued",
          rec.log_id || "",
          now
        ]);
      }
      if (rows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
      }
    },

    updateRecipientStatus: function (campaignId, recipientEmail, status, logId) {
      var norm = recipientEmail.trim().toLowerCase();
      var itemId = campaignId + ":" + norm;
      var sheet = getSheet(TAB_NAMES.CAMPAIGN_RECIPIENTS);
      var data = getSheetData(sheet);
      var now = new Date().toISOString();

      for (var i = 0; i < data.rows.length; i++) {
        var r = data.rows[i];
        if (String(r.item_id).trim() === itemId) {
          var rowIdx = r._rowIndex;
          // status is col 6, log_id is col 7, updated_at is col 8
          sheet.getRange(rowIdx, 6, 1, 3).setValues([[
            status,
            logId || r.log_id || "",
            now
          ]]);
          return true;
        }
      }
      return false;
    },

    // ==========================================
    // AUDIT LOG
    // ==========================================
    addAuditLog: function (entry) {
      var sheet = getSheet(TAB_NAMES.AUDIT_LOG);
      var auditId = "aud_" + Utilities.getUuid().replace(/-/g, "").substring(0, 12);
      var now = new Date().toISOString();
      sheet.appendRow([
        auditId,
        entry.admin_email.trim().toLowerCase(),
        entry.action,
        entry.target_identifier,
        entry.reason,
        now
      ]);
    },

    // ==========================================
    // ACTIVITY LOG
    // ==========================================
    addActivity: function (act) {
      var sheet = getSheet(TAB_NAMES.ACTIVITY_LOG);
      var activityId = "act_" + Utilities.getUuid().replace(/-/g, "").substring(0, 12);
      var now = new Date().toISOString();
      var detailsStr = typeof act.details === "object" ? JSON.stringify(act.details) : (act.details_json || "{}");

      sheet.appendRow([
        activityId,
        now,
        (act.actor_email || "system").trim().toLowerCase(),
        act.actor_role || "staff",
        act.action_category || "campaign",
        act.action,
        act.target_entity_type || "campaign",
        act.target_entity_id || "",
        detailsStr,
        act.status || "success"
      ]);
      return activityId;
    },

    listActivities: function (limit, offset, filterActor, filterCategory) {
      var sheet = getSheet(TAB_NAMES.ACTIVITY_LOG);
      var data = getSheetData(sheet);
      var allRows = data.rows;

      // Filter in reverse chronological order
      var filtered = [];
      var normActor = filterActor ? filterActor.trim().toLowerCase() : "";
      var normCat = filterCategory ? filterCategory.trim().toLowerCase() : "";

      for (var i = allRows.length - 1; i >= 0; i--) {
        var r = allRows[i];
        if (normActor && String(r.actor_email).trim().toLowerCase() !== normActor) {
          continue;
        }
        if (normCat && String(r.action_category).trim().toLowerCase() !== normCat) {
          continue;
        }
        filtered.push({
          activity_id: r.activity_id,
          timestamp: r.timestamp,
          actor_email: r.actor_email,
          actor_role: r.actor_role,
          action_category: r.action_category,
          action: r.action,
          target_entity_type: r.target_entity_type,
          target_entity_id: r.target_entity_id,
          details_json: r.details_json,
          status: r.status
        });
      }

      var total = filtered.length;
      var start = offset || 0;
      var end = Math.min(start + (limit || 100), total);
      var paginated = filtered.slice(start, end);

      return {
        total: total,
        rows: paginated
      };
    }
  };
})();
