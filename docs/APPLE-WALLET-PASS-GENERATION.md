# Apple Wallet Pass Generation System

## Overview

The GateEntry system now includes an Apple Wallet pass generation feature that allows HOA admins to create and distribute `.pkpass` files for iPhone users. These passes enable members to tap their iPhones directly against the NFC reader at the pool gate to gain access.

## For Admins

### Generating an Apple Wallet Pass

1. **Log in to the Admin Panel**
   - Go to http://localhost:3000/admin.html
   - Enter your admin credentials

2. **Navigate to Pool Management**
   - Click the "🏊 Pool Management" tab in the Management section

3. **Find the Member**
   - Look through the Pool Members list
   - Locate the member who needs an Apple Wallet pass

4. **Generate the Pass**
   - Click the **📱 Apple Pass** button in the Actions column
   - Your browser will automatically download a `.pkpass` file
   - The file name format is: `FirstName_LastName_pool_pass.pkpass`

5. **Share with Member**
   - Email the `.pkpass` file to the member
   - Or provide a download link

### What Gets Created

When you generate a pass:

- ✅ A **unique credential hash** (SHA-256 encrypted) is generated
- ✅ The credential is stored in the `pool_nfc_credentials` database table
- ✅ The pass includes member's name and "Pool Entry" access level
- ✅ A **pass serial number** (UUID) is generated for tracking
- ✅ NFC data is embedded with the credential hash

## For Members (End Users)

### Installing the Apple Wallet Pass

1. **Receive the email** with the `.pkpass` file attachment
2. **Open the email** on your iPhone
3. **Tap the `.pkpass` attachment**
   - Apple Wallet opens automatically
   - The pass preview displays your name and pool access info
4. **Tap "Add"** to add the pass to your Wallet
5. **Authenticate** with Face ID or Touch ID if prompted
6. **Done!** The pass is now in your Apple Wallet

### Using the Pass at the Gate

1. Open **Apple Wallet** on your iPhone
2. Find the **Glenridge Pool Pass**
3. Hold the **top of your iPhone** within 2 inches of the NFC reader
4. Authenticate with **Face ID/Touch ID** if prompted
5. Wait for **green light + beep** (access granted!)

## Technical Details

### Database Schema

The `pool_nfc_credentials` table stores:

```sql
CREATE TABLE pool_nfc_credentials (
  id TEXT PRIMARY KEY,                    -- UUID
  pool_member_id TEXT NOT NULL,           -- Foreign key to pool_members
  credential_hash TEXT NOT NULL UNIQUE,   -- SHA-256(credential_token)
  credential_type TEXT DEFAULT 'nfc_phone', -- Type of credential
  device_platform TEXT,                   -- 'ios', 'android', 'card', 'other'
  device_name TEXT,                       -- "Jane Doe's iPhone"
  pass_serial TEXT UNIQUE,                -- UUID for pass tracking
  pass_generated_at DATETIME,             -- When pass was generated
  status TEXT DEFAULT 'active',           -- 'active' or 'revoked'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  revoked_at DATETIME                     -- When revoked (if applicable)
)
```

### API Endpoints

#### Generate Apple Wallet Pass
```
POST /api/admin/pool/members/:memberId/generate-apple-pass
Response: Binary .pkpass file (Passbook format)
```

Returns a `.pkpass` file that can be downloaded directly or emailed to the member.

#### Get Member's Credentials
```
GET /api/admin/pool/members/:memberId/credentials
Response: JSON array of credentials for the member
```

Example response:
```json
[
  {
    "id": "uuid",
    "credential_type": "nfc_phone",
    "device_platform": "ios",
    "device_name": "Jane Doe's iPhone",
    "pass_serial": "uuid",
    "pass_generated_at": "2026-04-20T10:30:00Z",
    "status": "active"
  }
]
```

#### Revoke a Credential
```
POST /api/admin/pool/members/:memberId/credentials/:credentialId/revoke
Response: { "success": true, "message": "Credential revoked." }
```

## Pass Features

The generated `.pkpass` file includes:

- **NFC Data**: The credential hash embedded in NFC format
- **QR Code**: Barcode for backup/reference (contains credential hash)
- **Visual Design**: 
  - Glenridge HOA branding
  - Member name displayed
  - "Pool Entry" access label
  - Blue/green color scheme
  - Logo text "Glenridge"

## Security

### Credential Protection

- ✅ **Raw credentials never stored**: Only SHA-256 hashes are stored
- ✅ **One credential per member**: Each iPhone gets a unique hash
- ✅ **Revocable per-device**: Can revoke one device without affecting others
- ✅ **Cryptographic validation**: NFC reader validates hash locally on Pi

### Pass Distribution

- ✅ **Unique per member**: Each pass is different (unique serial number)
- ✅ **Cannot be reused**: Serial numbers prevent duplicate passes
- ✅ **Time-bound**: Optional expiration dates can be set via schedules
- ✅ **Member-specific**: Pass is tied to that member's ID and access rights

## Troubleshooting

### Issue: "Apple Wallet pass generation is not available"
- **Cause**: `passkit` package not installed
- **Solution**: Run `npm install passkit`

### Issue: Pass doesn't work at gate
- **Check**: Is the member's status "active"?
- **Check**: Does the member have an active schedule?
- **Check**: Is the Pi synchronized with the website?
- **Reset**: Generate a new pass if the old one is old

### Issue: Revoke a Pass
1. Go to Pool Members in admin panel
2. Click "Edit" on the member
3. In the member edit panel, look for "Associated Credentials"
4. Click "Revoke" on the credential you want to disable
5. The pass will no longer work at the gate

## Configuration

To customize the pass appearance, edit the `pass.nfc` section in server.js:

```javascript
nfc: {
  message: credentialHash,
  encryptionPublicKey: process.env.APPLE_NFC_PUBKEY || undefined
}
```

### Environment Variables (Optional)

Add to `.env` for customization:

```
APPLE_TEAM_ID=DEMO
APPLE_PASS_TYPE_ID=pass.glenridge.pool
APPLE_NFC_PUBKEY=<your-public-key>
```

## Sync with GateEntry Pi

The `pool_nfc_credentials` table is synced to the Raspberry Pi every hour through the standard GateEntry sync protocol:

1. **Hourly pull**: Pi requests updated credentials from website
2. **Hash validation**: Pi stores only the hashes, validates them locally
3. **Real-time**: Changes (revoke, suspend) take effect on next sync
4. **Offline operation**: Pi continues validating credentials even if website is down

## Future Enhancements

Possible future improvements:

- [ ] QR code generation for backup phone display
- [ ] Rolling TOTP (one-time code) support
- [ ] Biometric authentication at gate reader
- [ ] Pass expiration notifications
- [ ] Multiple devices per member with different schedules
- [ ] Family member pass generation
- [ ] Web-based pass download link instead of file attachment

---

*Last updated: April 20, 2026*  
*System: Glenridge Community HOA — GateEntry Pool Access*
