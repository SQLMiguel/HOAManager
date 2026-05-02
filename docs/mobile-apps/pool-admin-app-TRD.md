# Pool Gate Administrator App — Technical Requirements Document (TRD)

## 1) Technical Approach
Recommended stack:
- React Native + Expo + TypeScript
- Shared component library with member app
- Separate admin app package (or role-gated app variant)

## 2) Architecture
- Admin app talks to HOA backend admin APIs.
- Backend continues to be source of truth.
- Backend proxies gate controller details when needed (`/api/admin/gate/*`).
- Live log updates delivered via SSE/WebSocket, with polling fallback.

## 3) API Requirements
### 3.1 Guest/vendor management (existing + extensions)
- Reuse `/api/admin/pool/members` and entry type filtering by Vendor/Guest.
- Add convenience endpoint:
  - `PATCH /api/mobile/admin/access/:poolMemberId` { status: active|suspended|inactive }

### 3.2 Credential visibility
- Extend credential payload with masked/unmasked mode by role.
- Include `credential_type`, `device_platform`, `device_name`, `status`, `last_used_at`.

### 3.3 Live logs
- New endpoint options:
  - `GET /api/mobile/admin/logs/stream` (SSE)
  - or `WS /ws/admin/logs`
- Event payload includes sequence id for ordering and dedupe.

## 4) Security
- Admin auth token in secure device storage.
- Mandatory role check on every endpoint.
- Credential data masking policy by role.
- Immutable audit log for:
  - access enable/disable
  - credential revocations
  - emergency actions

## 5) Realtime Strategy
Preferred:
- SSE for simplicity on first release.
Fallback:
- 2-second polling to `/api/admin/pool/checkins?limit=...&since=...`

Target:
- New entry appears in app <= 2 seconds median.

## 6) Performance and Reliability
- Use local cache for last viewed records.
- Background refresh every 15–30 seconds when stream unavailable.
- Graceful degraded mode with clear “stale data” indicator.

## 7) Integration Notes from Current Codebase
Current backend already has:
- Pool members CRUD + statuses
- Credentials retrieval/revocation
- Check-in logs and gate snapshot proxy

Gaps to fill:
- True realtime delivery from backend to mobile.
- Endpoint shaping for mobile payload size and filter efficiency.
- Guest/vendor specific workflows and quick actions.

## 8) Delivery Plan
1. Build admin authentication + read-only dashboards.
2. Add quick enable/disable controls for guest/vendor.
3. Add credentials detail pages and revoke actions.
4. Add realtime logs (SSE first, poll fallback).
5. Add audit and role-hardening.

## 9) Risks and Mitigations
- **Risk**: stale logs during weak network.
  - Mitigation: stale badge, pull-to-refresh, auto reconnect.
- **Risk**: overexposure of credential identifiers.
  - Mitigation: role-based masking and least privilege defaults.
- **Risk**: accidental admin actions.
  - Mitigation: confirmations and undo window where feasible.

## 10) Confirmed Constraints (May 2026)
- Realtime log UX target is approximately 2 seconds.
- Credential identifiers are masked by default for admin roles.
- Full credential unmask requires super-admin privilege.
