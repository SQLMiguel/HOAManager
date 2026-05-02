# Glenridge Pool Admin App

Cross-platform admin app (iOS phone, iPad, Android phone, Android tablet) for
HOA pool administrators.

Built with **React Native + Expo + TypeScript**.

## Features (MVP)

- Admin sign-in with role verification (`isAdmin` required).
- Live entry log feed with ~2 second refresh and filters
  (All / Denied only / Guests & Vendors).
- Guest/vendor list with search, status badge, and one-tap
  enable/disable.
- Per-guest detail with masked credentials, revoke action, and
  status switch.
- Gate controller snapshot + manual resync trigger.
- Settings: server URL, super-admin credential unmask toggle,
  sign out.
- Tablet-friendly layout (multi-column tiles, max-width forms).

## Folder structure

```
pool-admin-app/
├── App.tsx
├── app.json                 (iOS supportsTablet: true)
├── babel.config.js          (path alias @/*)
├── package.json
├── tsconfig.json
├── assets/
└── src/
    ├── api/                 (client, auth, poolMembers, gate)
    ├── auth/AuthContext.tsx
    ├── components/          (Button, Card, StatusBadge)
    ├── navigation/RootNavigator.tsx
    ├── screens/
    │   ├── LoginScreen.tsx
    │   ├── HomeScreen.tsx
    │   ├── GuestsScreen.tsx
    │   ├── GuestDetailScreen.tsx
    │   ├── CheckinsScreen.tsx
    │   ├── GateSyncScreen.tsx
    │   └── SettingsScreen.tsx
    ├── theme/index.ts
    └── utils/               (storage, mask)
```

## First-time setup (Windows)

1. Install Node.js LTS and Git.
2. Install Expo Go on your iPhone, iPad, or Android device.
3. From this folder:

```pwsh
npm install
npm start
```

4. Scan the QR code with Expo Go on the same Wi-Fi network.

## Configuration

Edit `app.json` → `expo.extra.apiBaseUrl` to point at your HOA server. You can
also change the URL at runtime from the in-app **Settings** screen.

## Backend endpoints used

All already implemented in `server.js`:

- `POST /api/admin/login`
- `GET  /api/me`
- `POST /api/logout`
- `GET  /api/admin/pool/members`
- `PUT  /api/admin/pool/members/:id`
- `GET  /api/admin/pool/members/:id/credentials`
- `POST /api/admin/pool/members/:id/credentials/:credId/revoke`
- `GET  /api/admin/pool/checkins?limit=...`
- `GET  /api/admin/gate/snapshot`
- `POST /api/admin/gate/sync`

## Tablet support

Layouts use `useWindowDimensions()` and `isTabletWidth(width >= 768)` to switch
between single-column phone layouts and multi-column tablet layouts. Expo
config sets `ios.supportsTablet: true` so the same binary runs natively on
iPad.

## Building for stores

```pwsh
npm install -g eas-cli
eas login
eas build:configure
eas build --platform ios
eas build --platform android
```
