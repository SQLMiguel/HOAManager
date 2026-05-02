# Pool HOA Member App — Product Requirements Document (PRD)

## 1) Product Summary
The Pool HOA Member App allows residents to manage household pool credentials and open the pool gate quickly from their phone.

Primary platforms:
- iOS app (Apple devices)
- Android app

## 2) Goals
- Let a member see everyone active in their family group.
- Let a member see each family member credential type (phone and/or NFC card).
- Let a member update each family member phone and/or NFC card assignment.
- Most importantly: let a member open the gate quickly and reliably.

## 3) Users
- **Primary**: HOA approved resident account holder.
- **Secondary**: Household adult managing family member access.

## 4) In Scope (MVP)
1. Secure login (reuse HOA credentials).
2. Family roster with active/inactive status.
3. Credential view by person:
   - iOS phone registration
   - Android phone registration
   - RFID/NFC card assignment visibility
4. Credential update flows:
   - Register/replace phone per person
   - Revoke phone per person
   - Request/add/update card assignment flow
5. Gate open action:
   - “Open Gate” button with status feedback (success/denied/reason)
   - Fast response target: < 2 seconds on local pool Wi-Fi
6. Basic event history (last unlock attempts for this household).

## 5) Out of Scope (MVP)
- Full admin operations.
- Payment/billing.
- Visitor management approvals (admin app handles this).
- Full biometric credential enrollment beyond platform standard auth.

## 6) UX Requirements
- One-tap gate access from home screen.
- Minimum 44px touch targets, high contrast for sunlight readability at pool gate.
- Offline/poor network states must be explicit and user-friendly.
- Error messages must include actionable reason (e.g., outside schedule, suspended).

## 7) Functional Requirements
### FR-1 Family group view
- Show household owner + adults + children mapped from directory/pool member records.
- Show active pool status for each person.

### FR-2 Credential detail view
- Per person, show:
  - Credential type(s): iOS, Android, Card
  - Device label (if present)
  - Last updated timestamp
  - Active/revoked status

### FR-3 Credential updates
- Allow replacing existing phone assignment for self/adult/child.
- Allow revoking phone credential.
- Support card update request flow and display current card assignment.

### FR-4 Gate open
- Trigger gate unlock through backend endpoint.
- Display response states:
  - Allowed (with timestamp)
  - Denied (with reason)
  - Network unavailable
  - Unauthorized/session expired

### FR-5 Security
- Authenticated session required.
- No raw credential secret stored in plaintext on device.
- Use secure storage for tokens/session material.

## 8) Non-Functional Requirements
- Availability target for gate action UX: 99.9% during pool season.
- P95 gate-open API latency target: <= 1.5s on local network.
- Realtime feedback target for gate attempt status: <= 500ms after response.

## 9) Existing Backend Alignment (Current System)
Already available in `server.js`:
- Login/session APIs (`/api/login`, `/api/me`, etc.)
- Household directory APIs (`/api/directory/me`, adults/children)
- Phone registration APIs:
  - `GET /api/directory/me/pool-phones`
  - `POST /api/directory/me/pool-phones`
  - `DELETE /api/directory/me/pool-phones/:id`

Needs to be added for best mobile UX:
- Member-safe credential summary endpoint combining pool membership + card + phone state.
- Member gate-open endpoint with clear allow/deny reason payload.
- Member household entry-attempt history endpoint.

## 10) Acceptance Criteria
- Member can open the app and see all household members and their active pool status.
- Member can see credential type assigned per person.
- Member can update/revoke phone assignments per person.
- Member can tap “Open Gate” and reliably receive result in near real-time.

## 11) Open Questions
1. Should children under 16 be blocked from having independent phone credentials?
2. Should card changes be immediate self-service or require admin approval?
3. Should gate-open work only on pool Wi-Fi, or also via internet geofenced to pool location?
4. Do we require Face ID / fingerprint confirmation before each gate open?
5. How much history should members see (24h, 7d, 30d)?

## 12) Confirmed Decisions (May 2026)
- App strategy: two separate apps (member and admin).
- Gate-open scope: available from anywhere, but geofenced near pool location.
- Child credential policy: no independent phone credentials for children under 16.
- Biometric security: optional in app settings (not mandatory for every unlock).
