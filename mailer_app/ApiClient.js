/**
 * ApiClient.js — Mailer App Project
 * Authenticated HTTP communication bridge to the Control API with exponential backoff.
 */

var ApiClient = (function () {
  /**
   * Dispatches an authenticated request to the Control API.
   * @param {string} action
   * @param {string} callerEmail Server-derived Google account email
   * @param {Object} payload Endpoint-specific payload
   * @return {Object} Response object { ok: boolean, data?: any, message?: string, error?: string }
   */
  function callControlApi(action, callerEmail, payload) {
    var url = Config.getControlApiUrl();
    var secret = Config.getSharedSecret();

    var requestEnvelope = {
      secret: secret,
      action: action,
      caller_email: callerEmail,
      payload: payload || {}
    };

    var requestOptions = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(requestEnvelope),
      muteHttpExceptions: true
    };

    var maxAttempts = 3;
    var attempt = 0;
    var lastError = null;

    while (attempt < maxAttempts) {
      attempt++;
      try {
        var response = UrlFetchApp.fetch(url, requestOptions);
        var statusCode = response.getResponseCode();
        var responseText = response.getContentText();

        var parsedResponse;
        try {
          parsedResponse = JSON.parse(responseText);
        } catch (jsonErr) {
          throw new Error("Control API returned non-JSON response (HTTP " + statusCode + "): " + responseText.substring(0, 150));
        }

        // Retry on 429 Too Many Requests or 5xx server errors
        if ((statusCode === 429 || statusCode >= 500) && attempt < maxAttempts) {
          Utilities.sleep(Math.pow(2, attempt) * 500); // 1s, 2s backoff
          continue;
        }

        return parsedResponse;
      } catch (err) {
        lastError = err;
        if (attempt < maxAttempts) {
          Utilities.sleep(Math.pow(2, attempt) * 500);
        }
      }
    }

    throw new Error("Control API request failed after " + maxAttempts + " attempts: " + (lastError ? lastError.toString() : "Unknown error"));
  }

  return {
    call: callControlApi
  };
})();
