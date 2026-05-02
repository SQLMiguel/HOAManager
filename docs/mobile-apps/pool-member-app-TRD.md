# Pool HOA Member App — Technical Requirements Document (TRD)

## 1) Technical Approach
Recommended stack for first-time mobile delivery:
- **React Native with Expo** (single codebase for iOS + Android)
- TypeScript
- Expo Router
- Secure storage: `expo-secure-store`
- API data layer: TanStack Query

Reason: fastest beginner-friendly path to ship both platforms with fewer native build pitfalls.

## 2) Architecture
- Mobile app authenticates to HOA backend.
- App fetches member profile + household + credential summary.
- Gate-open action calls backend endpoint that delegates to GateEntry local controller workflow.
- App receives allow/deny with reason and renders immediate status.

## 3) Data Contracts (Proposed)
### 3.1 Member credential summary
`GET /api/mobile/member/household-credentials`

Response:
- household members list
- pool active status
- phone credentials
- card credentials
- last updated timestamps

### 3.2 Gate open
`POST /api/mobile/member/gate/open`

Request:
- optional context: location/network fingerprint, device id

Response:
- `allowed: boolean`
- `reason: string`
- `timestamp`
- optional gate transaction id

### 3.3 Entry history
`GET /api/mobile/member/gate/history?limit=50`

## 4) Security Requirements
- Session token stored in secure keychain/keystore.
- TLS required in production.
- Server-side authorization checks household ownership for all updates.
- Rate-limit gate-open endpoint per user + per device.
- Optional step-up auth (Face ID/biometric) for gate-open action.

## 5) Realtime & Responsiveness
- Optimistic UI button state while waiting for gate-open response.
- Request timeout policy:
  - soft timeout: 2s warning UI
  - hard timeout: 6s fail + retry prompt
- Optional near-realtime push updates for credential changes using WebSocket/SSE.

## 6) Integration with Current Backend
Current endpoints available:
- `/api/directory/me`
- `/api/directory/me/pool-phones`

Backend additions recommended:
- Member-safe gateway endpoint for gate open.
- Read endpoint to include card credentials (currently mostly admin-oriented in existing schema).
- Household normalized endpoint (adults, children, and pool status in one payload).

## 7) Logging and Observability
- App analytics events:
  - app_open
  - gate_open_tap
  - gate_open_success/denied/fail
  - credential_update_success/fail
- Backend logs include correlation id per gate-open request.

## 8) Performance Targets
- App launch to usable home: <= 2.5s P75 on modern phones.
- Gate-open round-trip: <= 1.5s P95 on pool Wi-Fi.

## 9) Delivery Plan
1. Build read-only family and credential screens.
2. Add credential update APIs and UX.
3. Add gate-open endpoint and live feedback UX.
4. Harden security + rate limits + biometric optional guard.
5. Beta with 10 families; fix before broad rollout.

## 10) Risks and Mitigations
- **Risk**: inconsistent family mapping.
  - Mitigation: create a server-side canonical household resolver endpoint.
- **Risk**: user confusion during denials.
  - Mitigation: normalized denial reason codes + user-friendly messages.
- **Risk**: network drops near gate.
  - Mitigation: quick retry UX, preflight network check, and clear fallback guidance.

## 11) Confirmed Constraints (May 2026)
- Gate-open requests must pass geofence validation near pool location.
- Under-16 members cannot have independent phone credentials.
- Biometric confirmation is optional and user-configurable.
