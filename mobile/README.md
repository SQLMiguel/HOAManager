# Glenridge HOA Mobile Apps

This folder houses all mobile application code for the Glenridge HOA system.

## Apps

| App | Path | Purpose |
|-----|------|---------|
| Pool Member App | `pool-member-app/` | Resident-facing app: family roster, credential management, gate open |
| Pool Admin App  | `pool-admin-app/` *(planned)* | Administrator-facing app: guest/vendor control, live entry logs |

Both apps are built with **React Native + Expo + TypeScript** and target:

- iPhone (iOS 15+)
- iPad (universal layout)
- Android phones (Android 8+)
- Android tablets

## Shared backend

All apps talk to the existing HOA website backend (`server.js`) over HTTPS using
the same authentication system used by the web members area.

See `docs/mobile-apps/` at the repo root for PRD/TRD documents.
