/**
 * Auth.js — Control API Project
 * Security validation, Staff Authorization, and HMAC Unsubscribe Token cryptography.
 */

var Auth = (function () {
  /**
   * Constant-time string comparison to prevent timing attacks.
   */
  function constantTimeEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    if (a.length !== b.length) return false;
    var result = 0;
    for (var i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  function base64UrlEncode(strOrBytes) {
    var b64;
    if (typeof strOrBytes === "string") {
      b64 = Utilities.base64EncodeWebSafe(strOrBytes);
    } else {
      b64 = Utilities.base64EncodeWebSafe(strOrBytes);
    }
    return b64.replace(/=+$/, "");
  }

  function base64UrlDecode(str) {
    var padded = str;
    while (padded.length % 4 !== 0) {
      padded += "=";
    }
    return Utilities.newBlob(Utilities.base64DecodeWebSafe(padded)).getDataAsString();
  }

  return {
    /**
     * Verifies the incoming shared secret against configured secret.
     */
    verifySharedSecret: function (incomingSecret) {
      var expectedSecret = Config.getSharedSecret();
      if (!incomingSecret || !constantTimeEqual(incomingSecret, expectedSecret)) {
        return false;
      }
      return true;
    },

    /**
     * Validates that caller exists in staff allowlist and is active.
     */
    verifyStaff: function (callerEmail) {
      if (!callerEmail) {
        throw new Error("Missing caller email identity.");
      }
      var staff = Db.getStaff(callerEmail);
      if (!staff || !staff.is_active) {
        throw new Error("Staff member '" + callerEmail + "' is not authorized or is inactive.");
      }
      return staff;
    },

    /**
     * Validates that caller is an active administrator.
     */
    verifyAdmin: function (callerEmail) {
      var staff = this.verifyStaff(callerEmail);
      if (!staff.is_admin) {
        throw new Error("Administrative privileges required for caller: " + callerEmail);
      }
      return staff;
    },

    /**
     * Generates a signed, tamper-proof unsubscribe token with 365-day expiration.
     * @param {string} recipientEmail
     * @return {string}
     */
    generateUnsubToken: function (recipientEmail) {
      var normEmail = recipientEmail.trim().toLowerCase();
      var now = Math.floor(new Date().getTime() / 1000);
      var exp = now + 365 * 24 * 60 * 60; // 365 days

      var payloadObj = {
        email: normEmail,
        iat: now,
        exp: exp
      };
      var payloadStr = JSON.stringify(payloadObj);
      var payloadB64 = base64UrlEncode(payloadStr);

      var key = Config.getHmacKey();
      var sigBytes = Utilities.computeHmacSha256Signature(payloadB64, key);
      var sigB64 = base64UrlEncode(sigBytes);

      return payloadB64 + "." + sigB64;
    },

    /**
     * Verifies an unsubscribe token signature and expiration.
     * @param {string} token
     * @return {{ valid: boolean, email: string, error: string }}
     */
    verifyUnsubToken: function (token) {
      if (!token || typeof token !== "string") {
        return { valid: false, email: "", error: "Missing token" };
      }

      var parts = token.split(".");
      if (parts.length !== 2) {
        return { valid: false, email: "", error: "Malformed token" };
      }

      var payloadB64 = parts[0];
      var sigB64 = parts[1];

      var key = Config.getHmacKey();
      var expectedSigBytes = Utilities.computeHmacSha256Signature(payloadB64, key);
      var expectedSigB64 = base64UrlEncode(expectedSigBytes);

      if (!constantTimeEqual(sigB64, expectedSigB64)) {
        return { valid: false, email: "", error: "Invalid signature" };
      }

      var payloadStr;
      try {
        payloadStr = base64UrlDecode(payloadB64);
      } catch (e) {
        return { valid: false, email: "", error: "Invalid payload encoding" };
      }

      var payload;
      try {
        payload = JSON.parse(payloadStr);
      } catch (e) {
        return { valid: false, email: "", error: "Invalid payload JSON" };
      }

      if (!payload.email || !payload.exp) {
        return { valid: false, email: "", error: "Missing token attributes" };
      }

      var now = Math.floor(new Date().getTime() / 1000);
      if (now > payload.exp) {
        return { valid: false, email: payload.email, error: "Token has expired" };
      }

      return { valid: true, email: payload.email.trim().toLowerCase(), error: "" };
    }
  };
})();
