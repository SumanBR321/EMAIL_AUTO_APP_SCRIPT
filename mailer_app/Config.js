/**
 * Config.js — Mailer App Project
 * Configuration and ScriptProperties manager.
 */

var Config = (function () {
  function getProp(key, defaultValue) {
    try {
      var val = PropertiesService.getScriptProperties().getProperty(key);
      return val !== null && val !== undefined && val !== "" ? val : defaultValue;
    } catch (e) {
      return defaultValue;
    }
  }

  return {
    getControlApiUrl: function () {
      var url = getProp("CONTROL_API_URL", "");
      if (!url) {
        throw new Error("CONTROL_API_URL is not configured in Script Properties. Please ask your administrator to set it.");
      }
      return url;
    },

    getSharedSecret: function () {
      return getProp("SHARED_SECRET", "DEV_DEFAULT_SECRET_CHANGE_IN_PRODUCTION_32B");
    }
  };
})();
