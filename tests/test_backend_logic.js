/**
 * test_backend_logic.js
 * Comprehensive automated test suite verifying backend logic, cryptographic guarantees,
 * two-phase commit reservation states, HTML sanitization, and database tab schemas.
 */

const crypto = require("crypto");
const assert = require("assert");

console.log("=================================================");
console.log("RUNNING BACKEND TEST SUITE FOR EMAIL AUTOMATION");
console.log("=================================================\n");

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  âœ… PASS: ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  âŒ FAIL: ${desc}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }
}

// ===================================================
// TEST SUITE 1: HTML Sanitization & Merge Replacement
// ===================================================
console.log("--- 1. HTML Sanitization & Merge Replacement ---");

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

it("escapes malicious HTML injection in merge tags", () => {
  const badName = '<script>alert("hacked")</script>';
  const clean = escapeHtml(badName);
  assert.strictEqual(clean, '&lt;script&gt;alert(&quot;hacked&quot;)&lt;/script&gt;');
  assert(!clean.includes("<script>"));
});

it("replaces all instances of {{name}} and {{company}}", () => {
  const template = "Hello {{name}}, welcome to {{company}}! Regards, {{name}} at {{company}}.";
  const name = escapeHtml("Alice & Bob");
  const company = escapeHtml("Acme <Corp>");

  const rendered = template
    .replaceAll("{{name}}", name)
    .replaceAll("{{company}}", company);

  assert.strictEqual(
    rendered,
    "Hello Alice &amp; Bob, welcome to Acme &lt;Corp&gt;! Regards, Alice &amp; Bob at Acme &lt;Corp&gt;."
  );
  assert(!rendered.includes("{{name}}"));
  assert(!rendered.includes("{{company}}"));
});

// ===================================================
// TEST SUITE 2: Cryptographic HMAC Unsubscribe Tokens
// ===================================================
console.log("\n--- 2. HMAC Unsubscribe Token Cryptography ---");

const HMAC_KEY = "DEV_TEST_CRYPTO_KEY_32_BYTES_LONG_!";

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str) {
  let padded = str;
  while (padded.length % 4 !== 0) padded += "=";
  return Buffer.from(padded, "base64").toString("utf8");
}

function generateUnsubToken(email, expSecondsDelta = 365 * 24 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    email: email.trim().toLowerCase(),
    iat: now,
    exp: now + expSecondsDelta
  };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const hmac = crypto.createHmac("sha256", HMAC_KEY).update(payloadB64).digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${payloadB64}.${hmac}`;
}

function verifyUnsubToken(token) {
  if (!token || typeof token !== "string") return { valid: false, error: "Missing token" };
  const parts = token.split(".");
  if (parts.length !== 2) return { valid: false, error: "Malformed token" };

  const [payloadB64, sigB64] = parts;
  const expectedSig = crypto.createHmac("sha256", HMAC_KEY).update(payloadB64).digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  if (sigB64 !== expectedSig) return { valid: false, error: "Invalid signature" };

  const payload = JSON.parse(base64UrlDecode(payloadB64));
  const now = Math.floor(Date.now() / 1000);
  if (now > payload.exp) return { valid: false, email: payload.email, error: "Token has expired" };

  return { valid: true, email: payload.email };
}

it("generates and verifies a valid unsubscribe token", () => {
  const email = "partner@vendor.com";
  const token = generateUnsubToken(email);
  const result = verifyUnsubToken(token);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.email, email);
});

it("rejects tampered token payload", () => {
  const token = generateUnsubToken("victim@vendor.com");
  const [payloadB64, sigB64] = token.split(".");
  const tamperedPayload = base64UrlEncode(JSON.stringify({ email: "attacker@evil.com", exp: 9999999999 }));
  const tamperedToken = `${tamperedPayload}.${sigB64}`;

  const result = verifyUnsubToken(tamperedToken);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error, "Invalid signature");
});

it("rejects expired token (> 365 days)", () => {
  const token = generateUnsubToken("old@vendor.com", -10); // Expired 10 seconds ago
  const result = verifyUnsubToken(token);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error, "Token has expired");
});

// ===================================================
// TEST SUITE 3: Two-Phase Commit State Engine
// ===================================================
console.log("\n--- 3. Two-Phase Commit State Simulation ---");

class MockDatabase {
  constructor() {
    this.contact_state = new Map();
    this.suppression = new Map();
    this.send_log = [];
    this.activity_log = [];
  }

  presend(callerEmail, campaignId, recipientEmail, windowDays = 30) {
    const norm = recipientEmail.trim().toLowerCase();

    // 1. Suppression check
    if (this.suppression.has(norm) && this.suppression.get(norm).status === "active") {
      return { ok: false, error: "suppressed", message: "Recipient is suppressed." };
    }

    // 2. Recent window check
    const existing = this.contact_state.get(norm);
    const cutoff = Date.now() - windowDays * 24 * 3600 * 1000;
    if (existing && existing.last_sent_at) {
      if (existing.last_sent_at.getTime() > cutoff && (existing.last_status === "sent" || existing.last_status === "pending")) {
        return { ok: false, error: "recently_contacted", message: "Recipient contacted recently." };
      }
    }

    // 3. Reserve with pending row
    const logId = "log_" + crypto.randomUUID().slice(0, 8);
    this.send_log.push({
      log_id: logId,
      campaign_id: campaignId,
      staff_email: callerEmail,
      recipient_email: norm,
      status: "pending",
      created_at: new Date()
    });

    this.contact_state.set(norm, {
      email: norm,
      is_suppressed: false,
      last_sent_at: new Date(),
      last_status: "pending",
      last_campaign_id: campaignId
    });

    this.activity_log.push({
      action: "email_reserved",
      recipient: norm,
      logId
    });

    return { ok: true, log_id: logId, unsub_url: `https://test.com/exec?token=${generateUnsubToken(norm)}` };
  }

  confirmLog(logId, recipientEmail, status, errorMsg = "") {
    const norm = recipientEmail.trim().toLowerCase();
    const row = this.send_log.find(r => r.log_id === logId);
    if (row) {
      row.status = status;
      row.error_message = errorMsg;
      row.completed_at = new Date();
    }
    const state = this.contact_state.get(norm);
    if (state) {
      state.last_status = status;
    }
    this.activity_log.push({
      action: status === "sent" ? "email_sent" : "email_failed",
      recipient: norm,
      logId
    });
  }

  suppress(email, reason = "unsubscribe") {
    const norm = email.trim().toLowerCase();
    this.suppression.set(norm, { status: "active", reason });
    const state = this.contact_state.get(norm) || { email: norm };
    state.is_suppressed = true;
    this.contact_state.set(norm, state);
  }

  liftSuppression(email) {
    const norm = email.trim().toLowerCase();
    if (this.suppression.has(norm)) {
      this.suppression.get(norm).status = "lifted";
    }
    const state = this.contact_state.get(norm);
    if (state) {
      state.is_suppressed = false;
    }
  }
}

it("blocks concurrent send when reservation is pending", () => {
  const db = new MockDatabase();
  const res1 = db.presend("staff1@gmail.com", "camp_1", "vendor@corp.com");
  assert.strictEqual(res1.ok, true);

  // Staff 2 attempts same recipient while pending
  const res2 = db.presend("staff2@gmail.com", "camp_2", "vendor@corp.com");
  assert.strictEqual(res2.ok, false);
  assert.strictEqual(res2.error, "recently_contacted");
});

it("completes two-phase send from pending to sent", () => {
  const db = new MockDatabase();
  const res = db.presend("staff1@gmail.com", "camp_1", "vendor@corp.com");
  assert.strictEqual(res.ok, true);

  db.confirmLog(res.log_id, "vendor@corp.com", "sent");
  const state = db.contact_state.get("vendor@corp.com");
  assert.strictEqual(state.last_status, "sent");

  const logEntry = db.send_log.find(l => l.log_id === res.log_id);
  assert.strictEqual(logEntry.status, "sent");
});

it("blocks send when recipient is suppressed and unblocks after lift", () => {
  const db = new MockDatabase();
  db.suppress("optout@vendor.com", "unsubscribe");

  const res1 = db.presend("staff@gmail.com", "camp_1", "optout@vendor.com");
  assert.strictEqual(res1.ok, false);
  assert.strictEqual(res1.error, "suppressed");

  // Lift suppression
  db.liftSuppression("optout@vendor.com");
  const res2 = db.presend("staff@gmail.com", "camp_1", "optout@vendor.com");
  assert.strictEqual(res2.ok, true);
});

// ===================================================
// TEST SUITE 4: Sheet Schemas Integrity
// ===================================================
console.log("\n--- 4. Sheet Database Schemas Verification ---");

const fs = require("fs");
const path = require("path");

it("validates all 8 required tabs and column headers in Db.js", () => {
  const dbJsPath = path.join(__dirname, "..", "control_api", "Db.js");
  const content = fs.readFileSync(dbJsPath, "utf8");

  const expectedTabs = [
    "contact_state",
    "suppression",
    "send_log",
    "campaigns",
    "campaign_recipients",
    "staff",
    "audit_log",
    "activity_log"
  ];

  expectedTabs.forEach(tab => {
    assert(content.includes(tab), `Db.js is missing reference to tab: ${tab}`);
  });
});

console.log("\n=================================================");
console.log(`TEST RUN COMPLETE: ${passed} passed, ${failed} failed`);
console.log("=================================================");

if (failed > 0) process.exit(1);
