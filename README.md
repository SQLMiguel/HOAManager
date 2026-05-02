# Glenridge HOA Manager

A complete homeowners-association platform for the Glenridge Community. The
repository contains four cooperating components that share a single backend
and database:

| Component | Path | Audience | Tech |
|-----------|------|----------|------|
| **Website** (member portal + admin) | repo root | Residents, board, admins | Node.js + Express + SQLite (sql.js) |
| **Gate Entry Controller** | `GateEntry/` | Raspberry Pi at the pool gate | Node.js + SQLite + MFRC522 RFID |
| **Pool Member Mobile App** | `mobile/pool-member-app/` | Residents (iOS, iPadOS, Android phone & tablet) | React Native + Expo + TypeScript |
| **Pool Admin Mobile App** | `mobile-apps-admin/pool-admin-app/` | HOA pool admins (iOS, iPadOS, Android phone & tablet) | React Native + Expo + TypeScript |

```
┌──────────────────────────────────────────────────────────────────┐
│  Member Mobile App (iOS/Android, phone & tablet)                 │
│  Admin Mobile App  (iOS/Android, phone & tablet)                 │
│         │                       │                                │
│         └───── REST / cookie ───┴────────┐                       │
│                                          ▼                       │
│  Website (Express + SQLite)  ◄──── Browser users (members/admin) │
│         │                                                        │
│         │  Hourly pull (members, schedules, credentials)         │
│         │  Push check-in logs                                    │
│         ▼                                                        │
│  Raspberry Pi Gate Controller  ──►  MFRC522 RFID/NFC reader      │
│                                       (cards, Apple/Google       │
│                                        Wallet passes, HCE)       │
└──────────────────────────────────────────────────────────────────┘
```

---

## 1. Website (`server.js`, repo root)

The website is the system of record. It serves resident-facing pages,
admin dashboards, and the JSON APIs used by the gate controller and the
mobile apps.

### Resident-facing features

- **Member sign-in** with email/password, Google, or Facebook (Passport).
- **Self-service password reset** via emailed reset link.
- **Member directory** with privacy controls and per-household editing.
- **Household management** — adults, children (with age-16 flag), pets, and
  per-person pool credentials.
- **Pool credential self-service** — register/replace/revoke a phone for
  yourself or a family member; under-16 children blocked from independent
  phone credentials.
- **Apple Wallet pass generation** for member pool credentials
  (signed `.pkpass`, distributed by email).
- **Google Wallet pass generation** for Android members.
- **Events calendar** with RSVP.
- **Newsletter** opt-in/opt-out, archived issues, public unsubscribe link.
- **Contact form** routed to the board.

### Admin features

- **Admin authentication** with role flag (`isAdmin`, optional super-admin
  role for credential unmasking).
- **Pool member management** — guests, vendors, caregivers, and resident
  pool members; create, update, enable/disable, delete.
- **Credential management** — assign or revoke RFID cards and phone
  credentials; generate Apple/Google Wallet passes.
- **Entry log viewer** — `/api/admin/pool/checkins` feeds the live entry
  list.
- **Gate sync controls** — view gate snapshot and trigger a manual
  resync (`/api/admin/gate/snapshot`, `/api/admin/gate/sync`).
- **Newsletter authoring** with image uploads, scheduled or immediate
  send, and per-recipient unsubscribe tokens.
- **Directory admin** — full edit access to households and member fields.
- **Audit-friendly endpoints** — every admin write is scoped behind
  `requireAdmin`.

### Backend APIs (highlights)

Auth & profile: `/api/login`, `/api/admin/login`, `/api/logout`, `/api/me`,
`/api/forgot-password`, `/api/reset-password`.

Directory & credentials: `/api/directory/me`,
`/api/directory/me/pool-phones` (GET/POST/DELETE).

Admin pool ops: `/api/admin/pool/members` (GET/POST/PUT/DELETE),
`/api/admin/pool/members/:id/credentials`,
`/api/admin/pool/members/:id/credentials/:credId/revoke`,
`/api/admin/pool/members/:id/generate-apple-pass`,
`/api/admin/pool/members/:id/generate-google-pass`,
`/api/admin/pool/checkins`, `/api/admin/gate/snapshot`,
`/api/admin/gate/sync`.

Gate sync (Raspberry Pi only, key-protected): `/api/gate/sync/pull`,
`/api/gate/sync/push`.

### Run the website

```pwsh
cd D:\HOA\HOAManager
npm install
node server.js
```

Then browse to <http://localhost:3000>.

Configuration via `.env` (SMTP, OAuth client IDs, gate API key,
Wallet signing certs, etc.). See `docs/Website-admin-manual.md` for
the full admin walkthrough and `docs/Website-user-manual.md` for the
resident guide.

---

## 2. Gate Entry Controller (`GateEntry/`)

A Raspberry Pi running a Node.js service that reads RFID/NFC credentials
from an MFRC522 reader, validates them against a local SQLite cache, and
opens the magnetic gate lock through a relay.

### Features

- **Unified credential pipeline** — physical RFID cards, iPhone Apple
  Wallet passes, Android Google Wallet / HCE, and optional BLE tokens
  all flow through the same allow/deny check.
- **Sub-2-second response** at the reader using a local SQLite cache.
- **Offline-tolerant** — if the website is unreachable, recent
  credentials still work from cache.
- **Hourly bi-directional sync** — pulls members, schedules, holidays,
  and credentials; pushes check-in logs back. Pushes use UUIDs and are
  idempotent on retry.
- **Per-credential revocation** — a member can have multiple devices
  enrolled, each independently revocable.
- **Schedule + holiday enforcement** — entry types respect daily hours
  and holiday overrides.
- **Phone credential security** — phone identifiers stored as SHA-256
  hashes; phone-unlock endpoint rate-limited.
- **Read-only Pi dashboard** at `http://<pi-ip>:8080` showing local
  members, credentials, schedules, check-ins, and sync status.
- **Manual sync** and **diagnostic** scripts (`manual-sync.js`,
  `test-rfid.js`).

### Deploy

```bash
# On the Raspberry Pi
git clone <this-repo>
cd HOAManager/GateEntry
./setup-pi.sh
```

Then configure `.env` with `WEBSITE_BASE_URL`, `GATE_API_KEY`, GPIO pins,
and pool location. Full hardware wiring, relay configuration, and
operator runbook are in:

- `GateEntry/docs/GateEntry-user-manual.md`
- `GateEntry/docs/RELAY-WIRING.md`
- `GateEntry/docs/ENV-CONFIGURATION.md`
- `docs/POOL-SCANNER-HARDWARE.md`

---

## 3. Pool Member Mobile App (`mobile/pool-member-app/`)

Single React Native + Expo codebase that runs on **iPhone, iPad,
Android phones, and Android tablets**.

### Features

- **Sign-in** with the existing HOA member account.
- **Family roster** with each person's registered credential type.
- **Per-person credential detail** — view, register, replace, or revoke
  a phone credential for yourself or a family member.
  Under-16 children are blocked from independent phone credentials.
- **Open Gate** — large one-tap unlock with optional Face ID /
  fingerprint gate (toggle in Settings) and a geofence check around the
  pool coordinates.
- **Recent entries** — household entry history with ~30s auto-refresh.
- **Settings** — server URL, biometrics toggle, sign out.
- **Tablet-aware layout** — multi-column tiles on iPad and Android
  tablets; centered max-width forms; `ios.supportsTablet: true`.
- **Secure session** stored in iOS Keychain / Android Keystore via
  `expo-secure-store`.

### Run on Windows

```pwsh
cd D:\HOA\HOAManager\mobile\pool-member-app
npm install
npm start
```

Scan the QR code with **Expo Go** on a phone or tablet on the same
Wi‑Fi network. On first launch, tap *Use a different server* on the
login screen and enter your PC's LAN IP, e.g. `http://192.168.1.50:3000`
(`localhost` only works on the PC itself).

Full setup, configuration (`apiBaseUrl`, `poolLatitude`,
`poolLongitude`, `poolGeofenceMeters`), and EAS Build instructions are
in `mobile/pool-member-app/README.md`. The product spec lives in
`docs/mobile-apps/pool-member-app-PRD.md` and
`docs/mobile-apps/pool-member-app-TRD.md`.

---

## 4. Pool Admin Mobile App (`mobile-apps-admin/pool-admin-app/`)

Single React Native + Expo codebase that runs on **iPhone, iPad,
Android phones, and Android tablets** — built for HOA pool admins
working at poolside or remotely.

### Features

- **Admin sign-in** with role verification (`isAdmin` required;
  super-admin unlocks credential unmasking).
- **Live entry feed** with ~2-second refresh and filters (All / Denied
  only / Guests & Vendors).
- **Guests & vendors list** with search, status badges, and one-tap
  enable/disable.
- **Guest detail** — toggle pool access, view credentials (masked by
  default with last-4 visible), and revoke individual credentials.
- **Gate sync** — view snapshot of the gate controller (online status,
  last sync, totals, pending changes) and trigger a manual resync.
- **Settings** — server URL, super-admin credential unmask toggle,
  sign out.
- **Tablet-aware layout** — multi-column tiles, two-column guest grid,
  max-width detail panes; `ios.supportsTablet: true`.
- **Reuses existing admin APIs** — no backend changes required.

### Run on Windows

```pwsh
cd D:\HOA\HOAManager\mobile-apps-admin\pool-admin-app
npm install
npm start
```

Scan the QR code with **Expo Go**. Configure the server URL the first
time you sign in (point at your PC's LAN IP for device testing, or
`http://10.0.2.2:3000` from an Android emulator).

Full setup notes are in
`mobile-apps-admin/pool-admin-app/README.md`. Product specs are in
`docs/mobile-apps/pool-admin-app-PRD.md` and
`docs/mobile-apps/pool-admin-app-TRD.md`.

---

## Repository layout

```
HOAManager/
├── server.js                 # Express backend + APIs (system of record)
├── package.json
├── *.html                    # Resident & admin web pages
├── css/  js/  images/        # Web assets
├── data/                     # SQLite database (sql.js)
├── docs/                     # User/admin manuals, PRDs, TRDs, hardware notes
│   └── mobile-apps/          # PRD + TRD for both mobile apps
├── GateEntry/                # Raspberry Pi gate controller
│   ├── src/                  # gate.js, rfid.js, sync.js, etc.
│   ├── public/               # Pi read-only dashboard
│   ├── docs/                 # Pi user manual, wiring, env config
│   └── setup-pi.sh
├── mobile/
│   └── pool-member-app/      # Expo React Native member app
└── mobile-apps-admin/
    └── pool-admin-app/       # Expo React Native admin app
```

---

## Documentation map

| Topic | File |
|-------|------|
| Executive summary | `docs/HOA-system-executive-summary.md` |
| Resident website manual | `docs/Website-user-manual.md` |
| Admin website manual | `docs/Website-admin-manual.md` |
| Apple Wallet pass generation | `docs/APPLE-WALLET-PASS-GENERATION.md` |
| Pool scanner hardware | `docs/POOL-SCANNER-HARDWARE.md` |
| Mobile credential cost breakdown | `docs/mobile_credential_cost_breakdown.md` |
| Gate controller user manual | `GateEntry/docs/GateEntry-user-manual.md` |
| Gate relay wiring | `GateEntry/docs/RELAY-WIRING.md` |
| Gate env configuration | `GateEntry/docs/ENV-CONFIGURATION.md` |
| Member app PRD / TRD | `docs/mobile-apps/pool-member-app-PRD.md`, `pool-member-app-TRD.md` |
| Admin app PRD / TRD | `docs/mobile-apps/pool-admin-app-PRD.md`, `pool-admin-app-TRD.md` |
| Mobile build step-by-step | `docs/mobile-apps/mobile-app-build-step-by-step.md` |

---

## License

Proprietary — Glenridge Community HOA. All rights reserved.
