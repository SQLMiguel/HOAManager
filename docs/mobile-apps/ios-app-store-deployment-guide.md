# Glenridge Pool iOS App Store Deployment Guide

This guide explains how to download the HOA Manager code from GitHub on an Apple desktop, build the Glenridge Pool member app, and submit it to the Apple App Store.

The member iPhone app is located at:

```text
mobile/pool-member-app
```

The app name is:

```text
Glenridge Pool
```

The iOS bundle identifier is:

```text
com.glenridge.poolmember
```

## Important Apple Wallet Note

Do not rely on Apple Wallet or NFC passes for this app. Apple restrictions make that path unsuitable for this gate-entry use case.

Use the app-based gate open flow instead:

- Members register their phone from the HOA website profile.
- The Glenridge Pool mobile app authenticates the member.
- The app verifies the member is near the pool gate.
- The app calls the backend/mobile gate-open endpoint.
- The backend contacts the Raspberry Pi gate controller.

## Requirements

Before starting, make sure you have:

1. A Mac desktop or MacBook.
2. Your GitHub repository access.
3. An Apple ID enrolled in the Apple Developer Program.
4. Access to App Store Connect.
5. Xcode installed from the Mac App Store.
6. Node.js LTS installed.
7. An Expo account.
8. EAS CLI access.
9. A working production HOA website at `https://www.GlenridgeCommunity.com`.
10. A test member account Apple can use during review.

## Step 1 - Install Mac Prerequisites

Install Xcode from the Mac App Store.

After installing Xcode, open it once so it can finish installing required components.

Install Node.js LTS from:

```text
https://nodejs.org/
```

Open Terminal and verify Node and npm:

```bash
node -v
npm -v
```

If Git is not installed, macOS may prompt you to install Xcode Command Line Tools the first time you run Git.

Verify Git:

```bash
git --version
```

## Step 2 - Clone the GitHub Repository

On the Mac, open Terminal and run:

```bash
cd ~
git clone https://github.com/YOUR-GITHUB-USERNAME/YOUR-REPO-NAME.git HOAManager
cd ~/HOAManager/mobile/pool-member-app
```

Replace the GitHub URL with the actual repository URL.

If the repository is private, GitHub may ask you to sign in or use a personal access token.

## Step 3 - Install App Dependencies

From the app folder:

```bash
cd ~/HOAManager/mobile/pool-member-app
npm install
```

Then run the TypeScript check:

```bash
npm run lint
```

Do not proceed to the App Store build until this passes.

## Step 4 - Set the Production API URL

Open:

```text
~/HOAManager/mobile/pool-member-app/app.json
```

Find this value:

```json
"apiBaseUrl": "http://localhost:3000"
```

Change it to:

```json
"apiBaseUrl": "https://www.GlenridgeCommunity.com"
```

Confirm this iOS bundle identifier is still present:

```json
"bundleIdentifier": "com.glenridge.poolmember"
```

Confirm the app name is still:

```json
"name": "Glenridge Pool"
```

## Step 5 - Test Locally

Start Expo:

```bash
npx expo start
```

To launch the iOS simulator:

```bash
npx expo start --ios
```

To test on a real iPhone, install Expo Go from the App Store and scan the QR code shown in Terminal.

Make sure the app uses:

```text
https://www.GlenridgeCommunity.com
```

Do not use `localhost` for App Store builds.

## Step 6 - Install and Log Into EAS

Install the EAS CLI:

```bash
npm install -g eas-cli
```

Log in:

```bash
eas login
```

Confirm login:

```bash
eas whoami
```

## Step 7 - Configure EAS

From the member app folder:

```bash
cd ~/HOAManager/mobile/pool-member-app
eas build:configure
```

Choose iOS when prompted.

This project already has an `eas.json` file, so EAS may only confirm or update the configuration.

## Step 8 - Create the App in Apple Developer and App Store Connect

Go to Apple Developer:

```text
https://developer.apple.com/account/resources/identifiers/list
```

Create an App ID with this bundle identifier:

```text
com.glenridge.poolmember
```

Then go to App Store Connect:

```text
https://appstoreconnect.apple.com/
```

Create a new app:

1. Go to Apps.
2. Click the plus button.
3. Choose New App.
4. Platform: iOS.
5. Name: Glenridge Pool.
6. Primary language: English.
7. Bundle ID: `com.glenridge.poolmember`.
8. SKU: `glenridge-pool-member`.

## Step 9 - Build the Production iOS App

From the app folder:

```bash
cd ~/HOAManager/mobile/pool-member-app
eas build --platform ios --profile production
```

When EAS asks about Apple credentials, the easiest option is usually:

- Let EAS manage credentials.
- Sign in with your Apple Developer account.
- Allow EAS to create/manage certificates and provisioning profiles.

When the build completes, EAS will produce an App Store-ready iOS build.

## Step 10 - Submit the Build to App Store Connect

From the app folder:

```bash
eas submit --platform ios --profile production
```

If prompted, select the latest successful iOS build.

EAS will upload the app to App Store Connect.

## Step 11 - Complete App Store Metadata

In App Store Connect, complete the app listing.

### App Description

Suggested description:

```text
Glenridge Pool lets approved Glenridge Community members access pool gate services from their mobile device.
```

### Privacy Policy URL

Use:

```text
https://www.GlenridgeCommunity.com/privacy.html
```

### Support URL

Use:

```text
https://www.GlenridgeCommunity.com/contact.html
```

### Category

Recommended category:

```text
Lifestyle
```

or:

```text
Utilities
```

### Screenshots

Create iPhone screenshots from the iOS Simulator or a real device.

App Store Connect commonly requires screenshots for current large iPhone display sizes, such as 6.7-inch displays.

### App Privacy

Because the app handles member gate access, do not select Data Not Collected unless you have confirmed that no user data is collected.

Likely disclosures may include:

- Account/login information.
- User or member identity.
- Location, because the app confirms the member is near the pool gate.
- App activity related to gate access.

### Review Notes

Apple usually needs a test account if the app requires login.

Create a demo member account and provide Apple something like:

```text
Test account:
Email: demo@example.com
Password: provide-demo-password

Notes:
This app is for Glenridge Community HOA members to access pool gate features. Location is used only to confirm the member is near the pool gate before opening access.
```

Do not provide your real admin account.

## Step 12 - Submit for Review

In App Store Connect:

1. Select the uploaded build.
2. Complete export compliance questions.
3. Complete app privacy questions.
4. Add review notes and test login.
5. Submit for review.

## Pre-Build Checklist

Before running the production build, verify:

- `app.json` uses `https://www.GlenridgeCommunity.com`, not `localhost`.
- The backend is deployed and running on Hostinger.
- The Raspberry Pi GateEntry service is running.
- Phone registration works from the HOA website profile.
- The demo member account can log in.
- App icons and splash images exist in `mobile/pool-member-app/assets/`.
- `npm run lint` passes.
- You have an Apple Developer account.
- The App Store Connect app record exists.

## Quick Command Sequence

Use this condensed command list after the Mac is prepared:

```bash
cd ~
git clone https://github.com/YOUR-GITHUB-USERNAME/YOUR-REPO-NAME.git HOAManager
cd ~/HOAManager/mobile/pool-member-app
npm install
npm run lint
npm install -g eas-cli
eas login
eas build:configure
eas build --platform ios --profile production
eas submit --platform ios --profile production
```
