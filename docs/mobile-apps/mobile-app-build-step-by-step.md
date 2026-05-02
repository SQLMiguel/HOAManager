# Mobile App Build Step-by-Step (Beginner Guide)

This guide explains how to build both iOS and Android apps for your Pool Entry system with one shared codebase.

## Phase 0 — Decide Project Shape
1. Use **React Native + Expo** for fastest iOS + Android development.
2. Build two apps:
   - **Pool Member App**
   - **Pool Admin App**
3. Keep one backend (`server.js`) and add mobile-focused API endpoints.

## Phase 1 — Set Up Accounts and Devices
1. Create Apple Developer account (for iOS App Store + Wallet/NFC features).
2. Create Google Play Console account.
3. Install on your computer:
   - Node.js LTS
   - Git
   - VS Code
   - Expo CLI tools
4. Install **Expo Go** on your iPhone and Android phone for testing.

## Phase 2 — Create the Mobile Project
1. Create a new Expo TypeScript app.
2. Add navigation, secure storage, and API libraries.
3. Create shared folders:
   - `src/screens`
   - `src/components`
   - `src/api`
   - `src/auth`
4. Create two app entry flows:
   - member flow
   - admin flow

## Phase 3 — Connect to Existing Backend
1. Reuse existing auth endpoints.
2. Add mobile-specific endpoints in `server.js` for:
   - household credential summary
   - gate open action
   - realtime/admin log stream
3. Add role checks for admin routes.
4. Test all APIs with Postman first, then mobile app.

## Phase 4 — Build Member App MVP
1. Login + session restore.
2. Family list screen.
3. Credential detail/update screen.
4. Gate open screen (big button, clear response messaging).
5. Household entry history screen.

## Phase 5 — Build Admin App MVP
1. Admin login + role validation.
2. Guest/vendor list and filters.
3. Enable/disable quick action.
4. Credential details per guest/vendor.
5. Live entry logs with denied-entry highlight.

## Phase 6 — Realtime, Security, and Reliability
1. Add SSE or WebSocket for near real-time logs.
2. Add rate limiting for gate-open endpoint.
3. Add secure token storage in keychain/keystore.
4. Add timeout/retry UX for weak gate-area networks.

## Phase 7 — Testing
1. Test on real iPhone + Android devices at the actual pool gate.
2. Test “outside schedule”, “suspended”, and “no network” scenarios.
3. Run a pilot with a small HOA group (5–10 households).
4. Fix UX friction before broad rollout.

## Phase 8 — Release
1. Create app icons, splash screen, and privacy policy.
2. Build signed iOS/Android release bundles.
3. Submit to TestFlight (iOS) and internal testing track (Google Play).
4. Roll out production release in stages.

## Phase 9 — Operations
1. Monitor gate-open latency and denial rates.
2. Track top support issues.
3. Ship monthly updates with small improvements.

## Practical Timeline (first-time team)
- Week 1–2: setup + API shaping
- Week 3–4: member app MVP
- Week 5–6: admin app MVP
- Week 7: realtime + hardening
- Week 8: pilot and release prep

## Fast-Track Option ("as soon as possible")
- Week 1: setup + member gate-open MVP
- Week 2: member credential management + basic admin controls
- Week 3: realtime admin logs + QA at pool gate
- Week 4: TestFlight + Play internal pilot
