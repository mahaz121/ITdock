# ITdock Security Audit Report

Audit date: 2026-07-13  
Scope: all 84 authored files, the complete 371-package npm tree, Docker/deployment configuration, documentation, generated build behavior, and all routes in `app/api/[[...path]]/route.js`. Generated `.next` output and third-party `node_modules` source were assessed through reproducible builds, the lockfile, and npm advisories rather than counted as authored application files.

## Executive summary

Total findings: 22

| Severity | Found | Fixed | Residual |
| --- | ---: | ---: | ---: |
| Critical | 2 | 2 | 0 |
| High | 12 | 10 | 2 |
| Medium | 7 | 3 | 4 |
| Low | 1 | 0 | 1 |

Security score after remediation: **72/100**. This is a point-in-time code review, not a guarantee that the application is “unbreakable.” Production assurance still requires infrastructure review, authenticated dynamic testing, backup/restore tests, malware scanning, monitoring, and periodic reassessment.

## Vulnerability details

### V-01 — Predictable default administrator (Critical, CVSS 9.8) — Fixed

- File/lines before fix: `app/api/[[...path]]/route.js`, former initialization block (now lines 509–528).
- Risk/exploit: a fresh deployment automatically created `admin/admin`, enabling unauthenticated administrative takeover.
- Vulnerable code: `password: hashPassword('admin')`.
- Fix: first startup now fails closed unless `INITIAL_ADMIN_EMAIL` and a policy-compliant `INITIAL_ADMIN_PASSWORD` are supplied. The password is Argon2id-hashed and is never logged. Deployment documentation and scripts were updated.
- Test: start against an empty database without bootstrap variables (startup fails); repeat with variables (one administrator is created); remove the password variable and restart (no second user is created).

### V-02 — Read-authorization bypass for ordinary users (Critical, CVSS 9.1) — Fixed

- File/lines: `app/api/[[...path]]/route.js:448`, enforced at line 656.
- Risk/exploit: any authenticated ordinary/viewer account could enumerate employees, assets, assignments, company emails, and dashboards because most GET routes only checked authentication.
- Vulnerable code: the old handler proceeded after `if (!user) return 401` without a route-level read policy.
- Fix: `readAllowed` denies ordinary users except their linked employee summary/vacation resource. Admin, asset manager, and IT support retain documented read access. API-key read scopes are enforced.
- Test: call `/api/employees` as ordinary (403), as asset manager (200), and `/api/employees/{linkedEmployeeId}` as the linked ordinary user (200).

### V-03 — Hardcoded cryptographic fallback secrets (High, CVSS 8.1) — Fixed

- Files/lines: `lib/auth.js:6–19`; `app/api/[[...path]]/route.js:12–16,197,221`.
- Risk/exploit: absent environment configuration silently selected public JWT/API-key secrets, allowing token forgery and offline API-key hash attacks.
- Fix: secrets must be independently configured, at least 32 characters, and known defaults are rejected. Docker Compose uses required-variable expansion.
- Test: security tests plus startup with missing/known fallback values.

### V-04 — Long-lived bearer tokens, localStorage theft, and ineffective revocation (High, CVSS 8.1) — Fixed

- Files/lines: `lib/auth.js:43–67,69–79`; `app/api/[[...path]]/route.js:18–27,195–260`; `app/page.js:54–105`.
- Risk/exploit: a seven-day token stolen through XSS remained valid even after its session record was deleted because authentication never checked that record.
- Fix: 15-minute HS256 tokens with fixed issuer/audience/algorithm, HttpOnly Secure-in-production SameSite=Strict cookie storage, token-hash-to-session validation on every request, and actual logout/revocation enforcement. Old localStorage tokens are removed.
- Test: authenticate, call `/api/auth/me`, revoke/delete the session, then repeat with the same cookie (401).

### V-05 — Permissive framing, CSP, and CORS (High, CVSS 8.0) — Fixed

- File/lines: `next.config.js:15–48`; API response helpers at `route.js:284–291`.
- Risk/exploit: `ALLOWALL`, `frame-ancestors *`, wildcard origin, and wildcard request headers enabled clickjacking and broad cross-origin API exposure.
- Fix: deny framing, same-origin API behavior, CSP, HSTS, MIME sniffing protection, referrer/permissions policy, and COEP/COOP/CORP. State changes validate `Origin` and authentication cookies use SameSite=Strict.
- Test: inspect production response headers; cross-origin POST must return 403 and iframe embedding must be blocked.

### V-06 — Unsafe file upload and download pipeline (High, CVSS 8.0) — Fixed

- Files/lines: `lib/security.js:3–38`; upload routes at `route.js:3019,3362,3524,3678`; download at `route.js:1838`.
- Risk/exploit: MIME/extension-only validation allowed disguised HTML or executable content, one route accepted any extension, stored paths were not centrally contained, and original filenames entered `Content-Disposition`.
- Fix: PDF/JPEG/PNG magic-byte validation, per-route size limits, server-chosen extension and UUID name, exclusive file creation with mode `0640`, canonical path containment, download authorization, no-store response, and safe disposition filename.
- Test: `tests/security.test.mjs`; additionally upload mismatched MIME/content, oversized, HTML, polyglot, and traversal filenames and expect rejection.

### V-07 — Asset-document IDOR (High, CVSS 7.5) — Fixed

- File/lines: `app/api/[[...path]]/route.js:1838–1860`.
- Risk/exploit: any authenticated user could download a document by ID even when that role could not list asset documents.
- Fix: download now requires asset-read permission and validates the stored path.
- Test: ordinary user requests a known document ID (403); asset manager requests it (200).

### V-08 — NoSQL/prototype injection and regex denial of service (High, CVSS 7.5) — Fixed

- Files/lines: `lib/security.js:40–69`; `route.js:186–192,705–755,1269–1273,1447–1451,1710–1714`.
- Risk/exploit: nested `$`/dot/prototype keys were accepted and user strings were passed directly to Mongo regular expressions, allowing operator smuggling or expensive regex evaluation.
- Fix: recursive NFKC normalization, depth/array/string limits, prohibited Mongo/prototype keys, escaped and length-limited regex terms, and request-size checks.
- Test: security tests reject `$where`, `constructor.prototype`, deep/oversized bodies, and regex metacharacter searches remain literal.

### V-09 — Asset mass assignment (High, CVSS 8.1) — Fixed

- File/lines: `app/api/[[...path]]/route.js:4190–4232`.
- Risk/exploit: asset managers could `$set` arbitrary JSON properties such as assignment/status/identity fields through a generic update spread, bypassing workflow controls.
- Fix: explicit mutable-field allowlist; generated tag/type and assignment/status fields cannot be changed through the generic endpoint. Provider URLs are limited to HTTP(S).
- Test: PUT `assigned_to`, `status`, `id`, or `asset_tag` and verify no change; permitted notes/brand fields update.

### V-10 — SMTP certificate bypass and unsafe mail features (High, CVSS 7.4) — Fixed

- File/lines: `lib/mail.js:14–44`.
- Risk/exploit: “none” mode set `rejectUnauthorized:false`; mail/header values accepted CR/LF; Nodemailer URL/file access features were not disabled.
- Fix: normal certificate validation, required TLS where selected, CR/LF rejection, patched Nodemailer 9.0.3, and URL/file access disabled at transport and message level.
- Test: untrusted/self-signed TLS server fails; CR/LF in any header/config field fails; normal TLS SMTP succeeds.

### V-11 — Password-reset host-header poisoning (High, CVSS 7.4) — Fixed

- File/lines: `app/api/[[...path]]/route.js:1994–2025`.
- Risk/exploit: forwarded host/protocol headers controlled the emailed reset origin, allowing a victim’s reset token to be sent to an attacker domain.
- Fix: production requires canonical `APP_URL`; forwarded host headers are not used; scheme is restricted to HTTP(S).
- Test: send forged Host/X-Forwarded-Host; generated link remains under `APP_URL`.

### V-12 — Deployment-script injection and secret disclosure (High, CVSS 7.8) — Fixed

- File/lines: `direct_deploy.sh:8–124`.
- Risk/exploit: passwords were interpolated into JavaScript/shell/URI contexts and printed at completion; the script later generated bcrypt directly.
- Fix: environment-mediated mongosh value, URL encoding, restrictive umask, generated independent secrets, bootstrap environment, `npm ci`, no password printing, and Argon2id application bootstrap.
- Test: deploy with shell metacharacters in passwords and confirm no command execution or terminal disclosure.

### V-13 — Password-policy bypass on administrator-created users (Medium, CVSS 6.5) — Fixed

- File/lines: `route.js:178–184,2348–2380,3983–4028`.
- Risk/exploit: user create/update accepted weak passwords even though change/reset routes checked policy.
- Fix: all password-writing flows require 12–128 characters with upper/lower/numeric composition and Argon2id. Existing bcrypt hashes are verified only for migration and rehashed immediately after successful login.
- Test: create/update/reset/change with weak passwords (400); strong passwords yield `$argon2id$` hashes.

### V-14 — Internal error disclosure (Medium, CVSS 5.3) — Fixed

- File/lines: `route.js:3847–3852`.
- Risk/exploit: unexpected exception messages were returned verbatim, disclosing database or filesystem internals.
- Fix: unexpected errors are logged server-side and return a generic 500; intentional 4xx errors preserve safe messages.
- Test: force a database exception and verify response omits driver details.

### V-15 — API-key scopes were informational only (Medium, CVSS 6.5) — Fixed

- File/lines: `route.js:240–260,296–305,448–455`.
- Risk/exploit: read-only API keys inherited the owning user’s write capabilities.
- Fix: GET requires `read`/`*`; mutation requires `write`/`*`; expiry and revocation are checked.
- Test: read key GET succeeds and POST fails 403; write key POST succeeds within RBAC limits.

### V-16 — Multi-document workflow race conditions (High, CVSS 7.1) — Open

- Files: assignment, vacation, custody, extension, maintenance, and scrap branches in `route.js`.
- Risk: separate writes can race or partially commit, causing duplicate assignments or inconsistent asset state.
- Required remediation: deploy MongoDB as a replica set, wrap each state transition in `withTransaction`, use conditional updates (`assigned_to:null`/expected version), add unique partial indexes for active assignment per asset, and return 409 on lost races.
- Verification: parallel integration tests issuing conflicting assignment/return/scrap requests; assert exactly one commit and consistent records.

### V-17 — TOTP and SMTP secrets stored plaintext in MongoDB (High, CVSS 7.2) — Open

- Files/lines: TOTP flows `route.js:2077–2110`; SMTP settings `route.js:3793–3844`; `lib/mail.js:4–12`.
- Risk: database read access exposes MFA seeds and SMTP credentials.
- Required remediation: envelope-encrypt with AES-256-GCM using a versioned key from KMS/Vault, unique 96-bit nonce, authenticated context, rotation/re-encryption job, and never return plaintext secrets after enrollment.
- Verification: database dump contains only versioned ciphertext; rotated old/new keys decrypt during migration; tampering fails authentication.

### V-18 — No malware scanner/quarantine (Medium, CVSS 6.1) — Open

- Files: upload routes listed in V-06.
- Risk: allowed PDF/image content can still be malicious to downstream viewers.
- Required remediation: write to a non-served quarantine, scan with ClamAV or managed scanning service, promote only a clean result, record hash/verdict, and alert on rejection.

### V-19 — CSP still permits inline script/style for Next compatibility (Medium, CVSS 5.4) — Open

- File/lines: `next.config.js:21–38`.
- Risk: `'unsafe-inline'` weakens CSP defense in depth.
- Required remediation: generate per-request nonces in middleware, pass them to Next, eliminate inline styles/scripts, then use `script-src 'self' 'nonce-…'` and `style-src` nonces/hashes.

### V-20 — Monitoring/alerting and correlation IDs absent (Medium, CVSS 5.3) — Open

- Files: route and deployment stack.
- Risk: audit rows exist, but application logs are unstructured and there are no alerts for lockouts, privilege changes, malware, or anomalous API-key use.
- Required remediation: JSON logger with request ID, redaction, centralized immutable log sink, SIEM rules, metrics, paging thresholds, retention and access policies.

### V-21 — Residual bundled PostCSS advisory (Medium, CVSS 6.1) — Open/mitigated

- Dependency: Next 15.5.16 bundles PostCSS 8.4.31; npm reports GHSA-qx2v-qp2m-jg93. Root PostCSS is 8.5.18.
- Exposure: build-time only in this repository; the application does not accept untrusted CSS for compilation. All listed Next runtime advisories are fixed at 15.5.16, but npm aggregates the bundled advisory as a high `next` record.
- Required remediation: upgrade when Next publishes a compatible release bundling PostCSS >=8.5.10; keep untrusted CSS out of builds.

### V-22 — Trusted-proxy assumptions for client IP (Low, CVSS 3.7) — Open

- Files/lines: `route.js:135–153,199–202`.
- Risk: rate-limit/session IP uses forwarded headers; if the app is reachable without a trusted reverse proxy that overwrites them, clients can spoof addresses.
- Required remediation: firewall direct app access, configure a single trusted proxy to overwrite forwarding headers, and derive client IP only from that trust boundary.

## Complete API calls list

Common behavior after remediation:

- All paths are under `/api` and implemented in `app/api/[[...path]]/route.js`.
- Only health, login, forgot/reset password, and TOTP login are unauthenticated.
- Browser authentication uses HttpOnly SameSite=Strict cookies; API keys use headers and enforce scopes.
- POST/PUT/DELETE enforce same origin. JSON bodies receive normalization/key/depth/size controls. Multipart routes additionally enforce magic-byte and per-type limits.
- Admin has all permissions; asset manager and IT support are restricted by `writeAllowed`; ordinary access is limited to its linked employee resource.
- Rate limiting is applied to login, TOTP login, and forgot password. Other endpoints rely on upstream/WAF throttling and should receive endpoint-specific production limits.

### GET endpoints

| Condition line | Path | Authorization / notable behavior |
| ---: | --- | --- |
| 603 | `/api/health` | Public; DB status only |
| 615 | `/api/auth/me` | Authenticated self |
| 624 | `/api/auth/totp/status` | Authenticated self |
| 631 | `/api/auth/api-keys` | Authenticated self |
| 638 | `/api/auth/sessions` | Authenticated self |
| 663, 667 | `/api/custody/template`, `/api/custody/forms` | Staff read |
| 673, 679, 685, 691 | `/api/companies`, `/api/projects`, `/api/locations`, `/api/departments` | Staff read |
| 697, 732 | `/api/extensions`, `/api/company-emails` | Staff read; escaped search regex |
| 768, 774 | `/api/categories`, `/api/categories/reset` | Categories is staff read; legacy reset returns 405 without mutation |
| 782, 848, 901, 942, 1128, 1150 | `/api/dashboard/charts`, `/bills`, `/stats`, `/notifications`, `/company-assets`, `/stock` | Staff read |
| 1170, 1178 | `/api/users`, `/api/filters` | Users admin-only; filters staff |
| 1196, 1294 | `/api/employees`, `/api/employees/:id` | Staff; linked ordinary may read own ID |
| 1363, 1471, 1496 | `/api/assets`, `/api/assets/unassigned`, `/api/assets/:id` | Staff read |
| 1545, 1625 | `/api/assignments`, `/api/maintenance` | Staff read |
| 1640, 1680 | `/api/audit`, `/api/audit/actors` | Admin/asset manager |
| 1691 | `/api/export/assets` | Staff export |
| 1726, 1739 | `/api/vacation/history`, `/api/vacation/active` | Staff read |
| 1752 | `/api/employees/:id/vacation` | Staff or linked ordinary own record |
| 1766, 1774 | `/api/assets/:id/documents`, `/api/assets/:id/addons` | Asset read permission |
| 1783 | `/api/assets/documents/:docId` | Asset read permission; contained attachment download |
| 1809 | `/api/settings/audit-schedule` | Staff read |
| 1815, 1854, 1864 | `/api/audits`, `/api/audits/due`, `/api/assets/:id/audits` | Admin/asset manager/IT support |
| 1873 | `/api/settings/smtp` | Super admin; password masked |

### POST endpoints

| Condition line | Path | Authorization / validation |
| ---: | --- | --- |
| 1899 | `/api/auth/login` | Public; rate limit, lockout, Argon2id, optional TOTP |
| 1939, 1974 | `/api/auth/forgot-password`, `/api/auth/reset-password` | Public; enumeration-safe/rate-limited; single-use token |
| 1998 | `/api/auth/totp/login` | Public second factor; rate limited |
| 2022, 2031, 2045 | `/api/auth/totp/setup`, `/enable`, `/disable` | Authenticated self |
| 2058, 2064, 2073 | `/api/auth/totp/status`, `/logout`, `/change-password` | Authenticated self |
| 2087 | `/api/auth/sessions/revoke-all` | Authenticated self |
| 2097 | `/api/auth/api-keys` | Authenticated self; scoped hashed key |
| 2124, 2151, 2174, 2196, 2218 | `/api/companies`, `/projects`, `/locations`, `/departments`, `/asset-categories` (`/categories`) | Admin/asset manager master-data write |
| 2249 | `/api/custody/forms` | Authorized custody creation |
| 2293 | `/api/users` | Admin; password policy |
| 2334 | `/api/employees/import` | Admin/asset manager; 5,000-row limit |
| 2497 | `/api/employees` | Authorized employee creation |
| 2565 | `/api/assets` | Asset manager/admin; generated tag/type and URL validation |
| 2637, 2661 | `/api/assets/renew`, `/api/assets/billing-update` | Asset write |
| 2689 | `/api/assets/:id/assignees` | Asset write |
| 2710, 2801, 2842, 2901 | `/api/assignments`, `/unassign`, `/bulk-unassign`, `/return-from-vacation` | Assignment workflow permission |
| 2964, 3011 | `/api/assignments/custody`, `/custody/delete` | Custody permission; PDF validation on upload |
| 3058, 3120, 3153 | `/api/maintenance`, `/complete`, `/reassign` | Maintenance permission |
| 3201, 3249 | `/api/assets/scrap`, `/api/maintenance/scrap` | Asset/maintenance write |
| 3307 | `/api/assets/documents` | Staff upload; type/size/magic validation |
| 3379, 3536 | `/api/vacation/start`, `/api/vacation/extend` | IT support/admin workflow |
| 3469, 3494, 3512 | `/api/vacation/handover/:id/upload-doc`, `/confirm-receipt`, `/return` | IT support/admin; PDF validation where applicable |
| 3560, 3581 | `/api/audits`, `/api/audits/schedule` | Audit staff |
| 3588, 3623 | `/api/audits/:id/complete`, `/api/audits/:id/attachments` | Audit staff; validated attachment |
| 3648, 3667 | `/api/company-emails`, `/api/extensions` | Admin/asset manager |
| 3710 | `/api/assets/:id/addons` | Asset staff |
| 3738, 3762 | `/api/settings/smtp`, `/api/settings/smtp/test` | Super admin; header/TLS controls |

### PUT endpoints

| Condition line | Path | Authorization |
| ---: | --- | --- |
| 3812 | `/api/custody/template` | Admin |
| 3818 | `/api/custody/forms/:id/assign` | Authorized workflow |
| 3832, 3850, 3867, 3884, 3901 | `/api/companies/:id`, `/projects/:id`, `/locations/:id`, `/departments/:id`, `/categories/:id` (`/asset-categories/:id`) | Admin/asset manager |
| 3929 | `/api/users/:id` | Self limited fields or admin; password policy |
| 3979 | `/api/employees/:id` | Authorized employee workflow |
| 4135 | `/api/assets/:id` | Asset write; explicit allowlist |
| 4180 | `/api/settings/audit-schedule` | Admin |
| 4195 | `/api/audits/:id` | Audit staff |
| 4221, 4228 | `/api/auth/sessions/:id`, `/api/auth/api-keys/:id` | Owning user only |
| 4237 | `/api/assets/:id/addons/:addonId` | Asset staff |
| 4270, 4287 | `/api/company-emails/:employeeId`, `/api/extensions/:id` | Admin/asset manager |

### DELETE endpoints

| Condition line | Path | Authorization |
| ---: | --- | --- |
| 4356 | `/api/custody/forms/:id` | Authorized; assigned forms protected |
| 4366, 4381, 4395, 4409, 4423 | `/api/companies/:id`, `/projects/:id`, `/locations/:id`, `/departments/:id`, `/categories/:id` | Admin/asset manager; in-use checks |
| 4439 | `/api/users/:id` | Super admin; cannot delete self |
| 4453 | `/api/employees/:id` | Authorized; active assignment check |
| 4476 | `/api/assets/:id/assignees/:employeeId` | Asset write |
| 4490 | `/api/assets/:id` | Asset write; assigned assets protected |
| 4510 | `/api/assets/documents/:docId` | Admin/asset manager; contained deletion |
| 4528 | `/api/assets/:id/addons/:addonId` | Asset staff |
| 4551, 4563 | `/api/company-emails/:employeeId`, `/api/extensions/:id` | Admin/asset manager |

## Dependency audit

- Lockfile and manifest match after `npm install --package-lock-only` and `npm ls --depth=0`.
- Full tree assessed: 371 packages. Initial npm audit: 8 records (1 critical, 4 high, 3 moderate). Final production audit: 2 records caused by Next’s bundled PostCSS (npm displays one as high aggregate and one moderate); direct runtime advisory ranges are fixed by Next 15.5.16.
- Removed unused/vulnerable `axios`, vulnerable npm `xlsx`, and application UUID dependency. Replaced spreadsheet handling with patched `@e965/xlsx` 0.20.3 and UUIDs with `crypto.randomUUID`.
- Upgraded: Next 14.2.3 → 15.5.16; Nodemailer 8.0.4 → 9.0.3; root PostCSS → 8.5.18; mongodb-memory-server → 11.2.0; follow-redirects overridden to 1.16.0.
- Added Argon2 0.44.0 and security-test runner `tsx` 4.20.6. Bcryptjs remains only for one-way migration verification of existing hashes; no new bcrypt hashes are created.
- Node 20.19+ is required by the updated toolchain and Docker is pinned to `node:20.19-alpine`.
- Exact direct and transitive versions, resolved tarballs, integrity hashes, and dependency edges are authoritative in `package-lock.json`.

## Fixed code files

- `lib/auth.js`: Argon2id, strict JWT configuration, cookie token extraction.
- `lib/security.js`: JSON/key limits, magic-byte validation, safe paths and URLs.
- `lib/mail.js`: TLS/header/file/URL hardening.
- `app/api/[[...path]]/route.js`: authorization, sessions, rate limits, input controls, upload/download controls, bootstrap, safer errors, URL/mass-assignment controls.
- `app/page.js`: HttpOnly-cookie client behavior, patched spreadsheet engine, formula-prefix protection and import size/row limits.
- `app/reset-password/page.js`: aligned password constraints.
- `next.config.js`: security headers and framework compatibility.
- `Dockerfile`, `docker-compose.yml`, `.env.example`, `direct_deploy.sh`: secure runtime/bootstrap/deployment defaults.
- `README.md`, `INSTALL.md`, `DEPLOYMENT.md`: removed insecure default-account/CORS guidance.
- `tests/security.test.mjs`, `package.json`, `package-lock.json`: regression tests and dependency remediation.

## Verification performed

- `npm run test:security`: 5/5 tests passed (normalization/operator rejection, magic bytes, traversal, URL schemes, Argon2id/JWT claims).
- `npm run build`: successful optimized production build under Next 15.5.16.
- `npm ls --depth=0`: dependency tree resolves.
- `npm audit --omit=dev`: two residual records, both tied to Next’s bundled old PostCSS as documented in V-21.
- Manual sink review: command execution/eval, database filters, filesystem operations, redirects/URLs, mail, HTML sinks, auth and authorization gates, deployment scripts, secrets, headers, uploads, logging and dependencies.

## Compliance checklist

| Control family | Status |
| --- | --- |
| OWASP Top 10 / CWE Top 25 code controls | Partially complete; open transaction, secret-at-rest, CSP, malware and monitoring work remains |
| Secrets removed from tracked source | Complete for live secrets; historical/example patterns reviewed, rotate any secret ever committed |
| SQL injection | Not applicable (MongoDB); NoSQL operator controls added |
| XSS | React escaping and URL restrictions present; print data escaped; nonce-based CSP remains open |
| CSRF | SameSite=Strict plus Origin enforcement for cookie-authenticated mutations |
| Rate limiting | Public auth endpoints complete; comprehensive per-endpoint/WAF policy open |
| Authentication / authorization | Materially hardened; linked ordinary-resource policy added |
| Encryption | TLS/JWT/password controls complete; field encryption at rest open |
| Logging / monitoring | Database audit trail present; centralized alerts/correlation open |
| PCI DSS / HIPAA | Not attested; no evidence this deployment is in assessed scope |
| GDPR / SOC 2 / ISO 27001 / NIST | Technical controls contribute, but organizational/process compliance cannot be certified from source review |

## Deployment security checklist

1. Generate independent JWT/API/encryption keys in a secrets manager; never reuse example values.
2. Bootstrap the administrator once, remove `INITIAL_ADMIN_PASSWORD`, and require MFA for privileged roles.
3. Set canonical HTTPS `APP_URL`; terminate TLS with modern ciphers and automate certificate renewal.
4. Place the app and MongoDB on private networks; expose only the reverse proxy; overwrite forwarding headers.
5. Run MongoDB as an authenticated replica set with least-privilege user, encrypted volumes, encrypted tested backups, and audit logging.
6. Use read-only container filesystem except the upload volume; retain non-root user and `0750`/`0640` permissions.
7. Add WAF/DDoS controls and endpoint-specific distributed rate limits.
8. Add quarantine/malware scanning before documents become downloadable.
9. Run `npm ci`, security tests, build, audit, secret scanning, SAST and container scanning in CI on every change.
10. Centralize logs/metrics/alerts and test incident response and disaster recovery at least annually.

## Incident response plan

1. **Detect and classify:** page the on-call owner, assign incident commander/scribe, record UTC timeline, affected systems, data classes and severity.
2. **Contain:** revoke affected sessions/API keys, disable compromised accounts, isolate app/DB nodes, block indicators at proxy/WAF, preserve service where safe.
3. **Preserve evidence:** snapshot disks/databases/logs, export immutable audit events, hash evidence, record custody, avoid modifying originals.
4. **Eradicate:** identify root cause, patch/rebuild from trusted source, rotate JWT/API/SMTP/DB/KMS credentials, scan persistence and dependencies.
5. **Recover:** restore verified backups if needed, deploy canary, validate authorization/data integrity, monitor elevated signals, obtain owner approval before full traffic.
6. **Notify:** engage legal/privacy/security leadership; meet contractual and jurisdictional notification deadlines; communicate facts without speculation.
7. **Learn:** complete post-incident review, track corrective actions with owners/dates, update detections/runbooks/tests, and verify closure.

## Security monitoring dashboard specification

- Authentication: login success/failure/lockout by account and trusted client IP; TOTP failures; password resets; session/API-key creation/revocation.
- Authorization: 401/403 rate, denied action/route/role, privilege and employee-link changes.
- Data/workflow: assignment conflicts, mass deletes, bulk imports, scrap/maintenance/vacation transitions, audit-log write failures.
- Files: upload count/bytes/type/hash, validation and malware verdict failures, download spikes, missing-file/path-control events.
- Platform: latency/error rate, event-loop/memory/disk/upload-volume usage, Mongo connections/replication lag, backup freshness/restore-test age.
- Alerts: credential stuffing, impossible API-key usage, repeated cross-origin rejection, privilege escalation, audit pipeline failure, malware detection, disk >80%, backup overdue.
- Every event should include UTC timestamp, correlation ID, actor/user/API-key ID, route/action/entity, outcome, trusted client IP, user agent and redacted details; never log passwords, raw tokens, reset tokens, TOTP secrets or SMTP credentials.

## Final recommendations

Prioritize V-16 and V-17 before calling this production-ready for sensitive data: transactional workflow integrity and encryption of stored MFA/SMTP secrets. Next, add upload malware quarantine, centralized monitoring, and nonce-based CSP. Keep Next upgrades under active review until its bundled PostCSS is patched, and schedule an authenticated DAST/concurrency assessment against a staging environment that mirrors the real reverse proxy, Mongo replica set, storage, and mail infrastructure.
