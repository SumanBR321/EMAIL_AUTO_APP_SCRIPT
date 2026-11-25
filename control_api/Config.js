/**
 * Config.js — Control API Project
 * Configuration, ScriptProperties management, and runtime environment constants.
 */

var Config = (function () {
  /**
   * Retrieves a property from ScriptProperties or returns a fallback value.
   * @param {string} key
   * @param {string} defaultValue
   * @return {string}
   */
  function getProp(key, defaultValue) {
    try {
      var val = PropertiesService.getScriptProperties().getProperty(key);
      return val !== null && val !== undefined && val !== "" ? val : defaultValue;
    } catch (e) {
      return defaultValue;
    }
  }

  return {
    getSpreadsheetId: function () {
      var id = getProp("SPREADSHEET_ID", "");
      if (!id) {
        // Fallback: If container-bound to the sheet
        try {
          var active = SpreadsheetApp.getActiveSpreadsheet();
          if (active) return active.getId();
        } catch (e) {}
      }
      return id;
    },

    getSharedSecret: function () {
      return getProp("SHARED_SECRET", "DEV_DEFAULT_SECRET_CHANGE_IN_PRODUCTION_32B");
    },

    getHmacKey: function () {
      return getProp("HMAC_KEY", "DEV_DEFAULT_HMAC_KEY_CHANGE_IN_PRODUCTION");
    },

    getAgencyName: function () {
      return getProp("AGENCY_NAME", "Apex Talent Partners");
    },

    getAgencyPostalAddress: function () {
      return getProp("AGENCY_POSTAL_ADDRESS", "100 Montgomery St, Suite 1500, San Francisco, CA 94104");
    },

    getWindowDays: function () {
      var days = parseInt(getProp("WINDOW_DAYS", "30"), 10);
      return isNaN(days) || days < 1 ? 30 : days;
    },

    getControlApiUrl: function () {
      var explicitUrl = getProp("CONTROL_API_URL", "");
      if (explicitUrl) return explicitUrl;
      try {
        var serviceUrl = ScriptApp.getService().getUrl();
        if (serviceUrl) return serviceUrl;
      } catch (e) {}
      return "";
    }
  };
})();
