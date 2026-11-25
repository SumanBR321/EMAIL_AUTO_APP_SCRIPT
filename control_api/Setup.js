/**
 * Setup.js — Control API Project
 * One-click initialization of the Google Sheets database with all 8 tabs,
 * exact column schemas, formatting, and initial admin record.
 */

function setupDatabase(initialAdminEmail) {
  var ss = Db.getSpreadsheet();
  var schemas = Db.SCHEMAS;
  var tabNames = Db.TAB_NAMES;

  var currentAdmin = initialAdminEmail || Session.getActiveUser().getEmail().trim().toLowerCase();
  if (!currentAdmin) {
    throw new Error("Unable to identify admin email. Please provide initialAdminEmail explicitly.");
  }

  // Iterate over each tab schema and ensure it exists and has proper headers
  for (var key in tabNames) {
    var tabName = tabNames[key];
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
    }

    var expectedHeaders = schemas[tabName];
    if (expectedHeaders) {
      var currentLastRow = sheet.getLastRow();
      if (currentLastRow === 0) {
        sheet.appendRow(expectedHeaders);
        sheet.setFrozenRows(1);

        // Style the header row (Shadow Grey background, White text, Bold)
        var headerRange = sheet.getRange(1, 1, 1, expectedHeaders.length);
        headerRange.setBackground("#282828");
        headerRange.setFontColor("#FFFFFF");
        headerRange.setFontWeight("bold");
        headerRange.setFontFamily("Inter");
        headerRange.setHorizontalAlignment("left");
      }
    }
  }

  // Remove default "Sheet1" if it exists and is empty
  var defaultSheet = ss.getSheetByName("Sheet1");
  if (defaultSheet && ss.getSheets().length > 1 && defaultSheet.getLastRow() === 0) {
    try {
      ss.deleteSheet(defaultSheet);
    } catch (e) {}
  }

  // Seed initial administrator into `staff` tab if empty
  var staffSheet = Db.getSheet(tabNames.STAFF);
  if (staffSheet.getLastRow() <= 1) {
    var now = new Date().toISOString();
    staffSheet.appendRow([
      currentAdmin,
      "System Administrator",
      "TRUE",
      "TRUE",
      now,
      "system_setup"
    ]);
    Logger.log("Seeded initial administrator: " + currentAdmin);
  }

  // Log setup completion
  Db.addActivity({
    actor_email: currentAdmin,
    actor_role: "admin",
    action_category: "admin",
    action: "system_setup",
    target_entity_type: "system",
    target_entity_id: ss.getId(),
    details: { message: "Spreadsheet database initialized with 8 tabs." },
    status: "success"
  });

  Logger.log("Database initialized successfully on spreadsheet: " + ss.getName() + " (" + ss.getId() + ")");
  return {
    ok: true,
    spreadsheet_id: ss.getId(),
    spreadsheet_url: ss.getUrl(),
    admin_email: currentAdmin
  };
}
