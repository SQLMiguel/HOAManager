# Pool Gate Administrator App — Product Requirements Document (PRD)

## 1) Product Summary
The Pool Gate Administrator App gives on-site administrators real-time control and visibility over pool access.

Primary platforms:
- iOS app
- Android app

## 2) Goals
- Enable/disable guest or vendor access quickly.
- View all guest records and exact registered phone/NFC card.
- View entry logs for every person entering the pool.
- Provide near-real-time operational visibility at pool gate.

## 3) Users
- HOA pool admins.
- Authorized gate supervisors (limited admin scope).

## 4) In Scope (MVP)
1. Admin authentication with role verification.
2. Guest/vendor lifecycle:
   - create
   - enable/disable
   - update credential assignment
3. Global credential view for guests/vendors.
4. Live entry log feed with filters.
5. Emergency controls:
   - suspend credential instantly
   - refresh gate sync status

## 5) Out of Scope (MVP)
- Full HOA website admin replacement.
- Financial/reporting modules.

## 6) Functional Requirements
### FR-1 Guest/vendor access control
- Enable/disable guest/vendor from mobile in < 10 seconds end-to-end.
- Changes should propagate to gate system immediately or near-immediately.

### FR-2 Guest record visibility
- For each guest/vendor show:
  - identity fields
  - access status
  - exact registered phone and/or NFC card
  - last access timestamp

### FR-3 Entry logs
- Show stream/list of entries:
  - person
  - credential type
  - exact credential identifier (masked unless privileged)
  - allow/deny result
  - timestamp
- Filters: all, denied only, guest/vendor only, time window.

### FR-4 Near real-time operation
- Log updates should appear with low delay while admin is at gate.
- Support manual refresh fallback.

## 7) Non-Functional Requirements
- Role-based authorization for every admin endpoint.
- P95 log feed refresh <= 2 seconds.
- Audit every admin change (who, what, when, from where).

## 8) Existing Backend Alignment (Current System)
Already available in `server.js`:
- Admin auth/session (`/api/admin/login` etc.)
- Pool member management:
  - `/api/admin/pool/members` (GET/POST/PUT/DELETE)
- Credential management:
  - `/api/admin/pool/members/:id/credentials`
  - revoke/add RFID routes
- Entry logs:
  - `/api/admin/pool/checkins`
- Gate snapshot/sync proxy:
  - `/api/admin/gate/snapshot`
  - `/api/admin/gate/sync`

Needs improvement for mobile-first real-time:
- Dedicated low-latency log streaming endpoint (SSE/WebSocket).
- Optimized guest/vendor-only endpoints.
- Privilege-aware masking for credential IDs.

## 9) Acceptance Criteria
- Admin can enable or disable a guest/vendor from phone quickly.
- Admin can see registered phone/card for each guest/vendor.
- Admin can monitor entry logs in near real-time at poolside.
- Admin can identify denied entries and act immediately.

## 10) Open Questions
1. Should all admins see full credential values, or masked by default?
2. Do you need different admin roles (viewer vs operator vs super-admin)?
3. What is acceptable “near real-time” target: 1s, 2s, 5s?
4. Should admin app work on cellular only, or require pool Wi-Fi/VPN?
5. Do you want emergency “lockdown mode” to deny all except admins/lifeguards?

## 11) Confirmed Decisions (May 2026)
- Access control should support custom rules by entry type.
- Near real-time target: approximately 2 seconds.
- Credential visibility: masked by default; unmask only for super-admin role.
