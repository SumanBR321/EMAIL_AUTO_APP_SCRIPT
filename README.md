# Google Apps Script Vendor Outreach System

A compliance-first, zero-budget bulk email outreach system built on Google Apps Script (GAS) and Google Sheets for an agency of ~50 staff using personal `@gmail.com` accounts to contact 2,000–4,000 vendors.

Built strictly according to [DESIGN.md](file:///D:/SELF/Internship/3SBC/Email%20Automation%20web%20app/DESIGN.md) and styled with the curvy minimalist aesthetic in [THEME.md](file:///D:/SELF/Internship/3SBC/Email%20Automation%20web%20app/THEME.md).

---

## 1. Architectural Highlights

* **Two-Project Security Model**:
  * **Control API (`control_api/`)**: Deployed with **Execute as: ME** (Administrator Google account), Access: **Anyone**. Owns the private Google Sheet database. Enforces the staff allowlist, suppression register, 30-day contact windows, two-phase commit reservation locks, and serves the public bot-resistant unsubscribe flow.
  * **Mailer App (`mailer_app/`)**: Deployed with **Execute as: USER ACCESSING**, Access: **Anyone with a Google account**. Sends from the staff member's own Gmail account utilizing their personal 100/day quota via `MailApp`. Calls the Control API before every send.
* **Server-Derived Identity**: Staff identity is strictly computed server-side via `Session.getActiveUser().getEmail()`. The browser cannot spoof or pass any caller identity.
* **Two-Phase Commit**: `/presend` reserves the recipient with `status = "pending"` inside `LockService.getScriptLock()` to prevent race conditions or duplicate sends across staff. `/log` updates to `sent` or `failed`.
* **Bot-Resistant Two-Step Unsubscribe**: Corporate email security scanners pre-fetching links via `GET` do not trigger unsubscribes. The `GET` request renders a styled confirmation page; a human must submit the `POST` form to permanently suppress the address. All links are signed with HMAC-SHA256 and expire after 365 days.
* **Universal Activity Logging**: Every session, campaign modification, reservation, send outcome, unsubscribe interaction, and administrative action is appended to the `activity_log` tab.

---

## 2. Repository Layout

```
Email Automation web app/
├── control_api/                   # Backend Project A: Database Owner & Policy Engine
│   ├── appsscript.json            # Manifest (Execute as ME, access ANYONE)
│   ├── Config.js                  # PropertiesService reader & default configs
│   ├── Db.js                      # Relational Sheet DAL (8 tabs, batch lookups, locks)
│   ├── Auth.js                    # Secret checks, staff auth, HMAC token signing
│   ├── Activity.js                # Centralized operational activity logger
│   ├── Endpoints.js               # Route handlers (/check, /preview, /presend, /log, etc.)
│   ├── Setup.js                   # One-click spreadsheet schema generator
│   ├── Unsubscribe.html           # THEME.md-styled two-step unsubscribe page
│   └── Code.js                    # doGet and doPost HTTP request routers
├── mailer_app/                    # Backend Project B: Staff Mailer & Execution Engine
│   ├── appsscript.json            # Manifest (Execute as USER_ACCESSING, MailApp scopes)
│   ├── Config.js                  # ScriptProperties manager (CONTROL_API_URL, SHARED_SECRET)
│   ├── ApiClient.js               # Authenticated HTTP bridge with exponential backoff
│   ├── MailerService.js           # Two-phase commit sender, HTML sanitizer & CAN-SPAM footer
│   └── Code.js                    # google.script.run server endpoints (Session-derived identity)
├── tests/
│   └── test_backend_logic.js      # Automated Node.js verification test suite
├── DESIGN.md                      # Comprehensive Architecture & Design Specification (v1.2)
├── THEME.md                       # Design System & Curvy SaaS Aesthetic Specification
└── README.md                      # Project setup & operational guide
```

---

## 3. Database Schema (8 Google Sheet Tabs)

1. `contact_state`: Fast indexed lookup table containing one row per unique vendor (`is_suppressed`, `last_sent_at`, `last_status`).
2. `suppression`: Permanent opt-out register (`status = "active" | "lifted"`, `reason`, `source`). Rows are never deleted.
3. `send_log`: Append-only transactional audit trail of every email reservation and delivery outcome.
4. `campaigns`: Persistent campaign records (`total_count`, `sent_count`, `failed_count`, `status`).
5. `campaign_recipients`: Persistent queue of campaign recipients (`status = "queued" | "pending" | "sent" | "failed"`).
6. `staff`: Whitelist of authorized staff emails and admin flags (`is_active`, `is_admin`).
7. `audit_log`: Administrative records for manual suppression lifts (mandatory justification ≥ 10 chars).
8. `activity_log`: Universal ledger tracking operational events across all users.

---

## 4. Setup & Deployment Instructions

### Step 1: Deploy the Control API

1. Create a new Google Sheet named `Vendor Outreach Database` in the Admin Google account. Copy its **Spreadsheet ID** from the URL.
2. Go to [script.google.com](https://script.google.com) and create a new project named **Vendor Outreach Control API**.
3. Copy the files from `control_api/` into the Apps Script editor:
   * `appsscript.json` (Project Settings > Show "appsscript.json" manifest)
   * `Config.gs`
   * `Db.gs`
   * `Auth.gs`
   * `Activity.gs`
   * `Endpoints.gs`
   * `Setup.gs`
   * `Unsubscribe.html`
   * `Code.gs`
4. Set the **Script Properties** (Project Settings > Script Properties):
   * `SPREADSHEET_ID`: `<YOUR_SPREADSHEET_ID>`
   * `SHARED_SECRET`: `<RANDOM_32_CHAR_SECRET>`
   * `HMAC_KEY`: `<RANDOM_32_CHAR_CRYPTO_KEY>`
   * `AGENCY_NAME`: `Apex Talent Partners`
   * `AGENCY_POSTAL_ADDRESS`: `100 Montgomery St, Suite 1500, San Francisco, CA 94104`
   * `WINDOW_DAYS`: `30`
5. In the Apps Script editor, select the function **`setupDatabase`** in `Setup.gs` and click **Run**.
   * Grant authorization when prompted.
   * This creates all 8 tabs with frozen styled headers and adds your admin email to `staff`.
6. Click **Deploy > New Deployment**:
   * Type: **Web app**
   * Description: `Control API Production v1`
   * Execute as: **Me**
   * Who has access: **Anyone**
7. Copy the **Web App URL** (e.g. `https://script.google.com/macros/s/CONTROL_ID/exec`).
8. Add this URL to Script Properties as `CONTROL_API_URL`.

---

### Step 2: Deploy the Mailer App

1. In [script.google.com](https://script.google.com), create a second project named **Vendor Outreach Mailer App**.
2. Copy the files from `mailer_app/` into the project:
   * `appsscript.json`
   * `Config.gs`
   * `ApiClient.gs`
   * `MailerService.gs`
   * `Code.gs`
3. Set the **Script Properties**:
   * `CONTROL_API_URL`: `<CONTROL_API_WEB_APP_URL>` (from Step 1)
   * `SHARED_SECRET`: `<MATCHING_SHARED_SECRET>` (same as in Step 1)
4. Click **Deploy > New Deployment**:
   * Type: **Web app**
   * Description: `Mailer App Production v1`
   * Execute as: **User accessing the web app**
   * Who has access: **Anyone with a Google account**
5. Distribute the Mailer App Web App URL to agency staff members who are on the `staff` allowlist.

---

## 5. Offline Automated Verification

Run the test suite using Node.js to verify the core algorithms, HMAC signature cryptography, HTML sanitization, two-phase reservation states, and tab schema mappings:

```powershell
node tests/test_backend_logic.js
```
