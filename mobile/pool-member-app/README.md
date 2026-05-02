# Glenridge Pool Member App

Cross-platform mobile app (iOS phone, iPad, Android phone, Android tablet) for
Glenridge HOA residents to manage household pool credentials and open the pool
gate.

Built with **React Native + Expo + TypeScript**.

## Features (MVP)

- Sign in with existing HOA credentials.
- View family/household roster.
- View and update phone credentials per household person.
- "Open Gate" action with geofence + optional biometric confirmation.
- Recent entry history.
- Settings: server URL, biometric toggle, sign out.
- Tablet-friendly layout (multi-column on iPad / Android tablets).

## Folder structure

```
pool-member-app/
├── App.tsx
├── app.json
├── babel.config.js
├── package.json
├── tsconfig.json
├── assets/                  # icons, splash
└── src/
    ├── api/                 # client + endpoints (auth, household, gate)
    ├── auth/                # AuthContext provider
    ├── components/          # Button, Card, StatusBadge
    ├── navigation/          # Stack navigator
    ├── screens/             # Login, Home, Family, CredentialDetail, GateOpen, History, Settings
    ├── theme/               # colors, spacing, breakpoints
    └── utils/               # secure storage, geofence
```

## First-time setup (Windows)

1. Install Node.js LTS and Git.
2. Install Expo Go on your iPhone and Android phone (App Store / Play Store).
3. From a terminal in this folder:

```pwsh
npm install
npm start
```

4. Scan the QR code with Expo Go on iOS or Android.
5. To run on iPad or an Android tablet, install Expo Go on the tablet and scan
   the QR code from the same Wi-Fi network.

## Configuration

Edit `app.json` → `expo.extra`:

| Key | Description |
|-----|-------------|
| `apiBaseUrl` | URL of the HOA backend (e.g. `http://192.168.1.100:3000`) |
| `poolLatitude` | Latitude of the pool gate for geofence |
| `poolLongitude` | Longitude of the pool gate for geofence |
| `poolGeofenceMeters` | Allowed radius in meters (default 250) |

You can also change the server URL at runtime from the in-app **Settings**
screen.

## Backend endpoints used

Already implemented in `server.js`:

- `POST /api/login`
- `POST /api/logout`
- `GET  /api/me`
- `GET  /api/directory/me`
- `GET  /api/directory/me/pool-phones`
- `POST /api/directory/me/pool-phones`
- `DELETE /api/directory/me/pool-phones/:id`

To be added (see `docs/mobile-apps/pool-member-app-TRD.md`):

- `POST /api/mobile/member/gate/open`
- `GET  /api/mobile/member/gate/history`

Until those endpoints exist, the Gate Open and History screens display a
clear, informative error.

## Tablet support

Layouts use `useWindowDimensions()` and a `isTabletWidth(width)` helper
(`>= 768 px`) to switch between single-column phone layouts and multi-column
tablet layouts (Home tiles, Family grid, centered max-width forms).

The Expo config sets `ios.supportsTablet: true` so the same binary runs
natively on iPad.

## Building for stores

For real release builds use **EAS Build**:

```pwsh
npm install -g eas-cli
eas login
eas build:configure
eas build --platform ios
eas build --platform android
```

Then submit to TestFlight (iOS) and Play Console internal testing (Android).
