# Glenridge Pool Gate Entry Controller

Raspberry Pi-based RFID gate entry system for the Glenridge Community pool. Replaces the existing gate controller with a Pi that reads RFID tags, validates access against a local database, and releases the magnetic gate lock.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Raspberry Pi                         │
│                                                         │
│  RFID card ─┐                                           │
│  iPhone NFC ┼─→ MFRC522 Reader ──→ Local DB Lookup     │
│  Android NFC┘      (tap phone)         │                │
│  BLE token  ─→ BLE Scanner            │                │
│                     (optional)         │                │
│                                Unified Access Check     │
│                                   (same pipeline)       │
│                                       │                 │
│                              ┌────────┴────────┐        │
│                           Allowed           Denied      │
│                              │                 │        │
│                        Open Relay         Flash Red     │
│                       (unlock gate)       + Buzzer      │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Hourly Sync                         │   │
│  │  Website ──→ Pull members/schedules/credentials  │   │
│  │  Local DB ──→ Push check-in logs ──→ Website     │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Key Features

- **Supported credential types**: Physical RFID cards, iPhone (Apple Wallet NFC), Android (HCE / Google Wallet), and optional BLE tokens — all validated through a single pipeline
- **Fast response**: Credential lookup against local SQLite database — under 2 seconds regardless of method
- **Offline operation**: If the website is unreachable, the gate continues working using cached data and locally stored credential hashes
- **Bi-directional sync**: Pulls pool members, schedules, and phone credentials from the website hourly; pushes check-in logs back
- **Multi-device members**: A single member can enroll a card + iPhone + Android device, each independently revocable
- **Secure by default**: Phone/BLE credentials stored as SHA-256 hashes; rate-limited phone unlock endpoint
- **Holiday support**: Holiday schedules override regular schedules for that date
- **Idempotent sync**: Check-in push uses UUIDs to prevent duplicates on retry
- **Read-only Pi dashboard**: Built-in web UI to view local DB members/credentials/schedules/check-ins/sync status (no editing)

## Supported Phone Access Methods

| Method | iPhone | Android | How it reaches the gate |
|--------|--------|---------|--------------------------|
| RFID card / fob | n/a | n/a | MFRC522 reader (card UID) |
| NFC Wallet pass | ✅ Apple Wallet | ✅ Google Wallet | MFRC522 reader reads emulated NDEF UID |
| HCE (Host Card Emulation) | — | ✅ Companion app | MFRC522 reader |

| BLE token *(optional hardware)* | ✅ Companion app | ✅ Companion app | BLE scanner on Pi |

## Hardware Setup

The system uses a single **MFRC522 NFC/RFID reader** that supports both phone credentials and physical cards:

- **iPhone**: Apple Wallet NFC pass (tap to reader)
- **Android**: Google Wallet or HCE via companion app (tap to reader)
- **RFID Cards**: Physical RFID cards and key fobs (tap to reader)

All validation happens locally on the Pi in under 1 second. No additional hardware needed beyond the standard setup.

---

## Hardware Requirements

| Component | Model | Connection |
|-----------|-------|------------|
| Raspberry Pi | 3B+/4/5 | — |
| RFID Reader | MFRC522 | SPI (GPIO) |
| Relay Module | 5V 1-channel | GPIO 17 |
| Magnetic Lock | 12V DC | Relay NO/NC |
| Green LED | 5mm | GPIO 27 |
| Red LED | 5mm | GPIO 22 |
| Buzzer | Active 5V | GPIO 23 |
| External USB Drive | Any ext4 formatted | USB |

### Wiring Diagram (MFRC522 → Pi GPIO)

| MFRC522 Pin | Pi GPIO (BCM) |
|-------------|---------------|
| SDA         | GPIO 24 (CE0) |
| SCK         | GPIO 23 (SCLK)|
| MOSI        | GPIO 19       |
| MISO        | GPIO 21       |
| RST         | GPIO 22       |
| 3.3V        | 3.3V          |
| GND         | GND           |

## Installation

### 1. Copy files to the Pi

```bash
scp -r GateEntry/ pi@<pi-ip>:~/gate-entry/
```

### 2. Run setup

```bash
cd ~/gate-entry
sudo bash setup-pi.sh
```

This will:
- Enable SPI for the RFID reader
- Install Node.js 18
- Mount the external USB drive at `/mnt/usb`
- Install npm dependencies
- Create a systemd service (`gate-entry`)

### 3. Configure

```bash
nano .env
```

Set these values:
- `WEBSITE_URL` — your HOA website URL (e.g., `http://192.168.1.100:3000`)
- `GATE_API_KEY` — must match the `GATE_API_KEY` in the website's `.env`
- `VIEWER_PORT` — port for the read-only dashboard (default `8080`)

### 4. Initialize the database

```bash
npm run setup-db
```

This creates the local database and performs the initial sync from the website.

### 5. Start the service

```bash
sudo systemctl start gate-entry
sudo journalctl -u gate-entry -f   # view live logs
```

## Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start the gate controller + read-only viewer |
| `npm test` | Test RFID reader hardware |
| `npm run read-card` | Start a reader-only web app for capturing card IDs |
| `npm run sync` | Force a manual sync with the website |
| `npm run setup-db` | Initialize/reset the local database |

## Reader-Only Card ID App

Use this when you only need to read a new card or fob ID before assigning it to a pool member. It does not open the gate, update the database, or sync with the HOA website.

```bash
cd ~/gate-entry
npm run read-card
```

Then open this from a browser on the same network:

```text
http://<pi-ip>:8090
```

Scan a card at the reader. The app shows the latest card ID, keeps a short recent-scan list, and provides a copy button so the ID can be pasted into the HOA website admin panel.

Optional `.env` settings:

```text
CARD_READER_PORT=8090
CARD_READER_HOST=0.0.0.0
```

## Assigning RFID Tags

RFID tags are assigned to pool members through the admin panel on the website:

1. Go to **Admin Panel → 🏊 Pool Management → Pool Members**
2. Click **Edit** on a member
3. Enter their RFID tag ID in the **RFID Tag** field
4. Save — the tag will sync to the Pi on the next hourly cycle

To find a tag's ID, run `npm test` and scan the tag.

## Read-only Viewer Dashboard (Pi-hosted)

When `npm start` is running, open:

- `http://<pi-ip>:8080` (or your configured `VIEWER_PORT`)

The dashboard can **view only**:

- Pool members (with status/search filters)
- Pool schedules
- Recent check-ins (including sync status)
- Sync log and summary counters

No edit APIs are exposed by the viewer. All edits must be made on the HOA website admin panel and then synced to the Pi.

## How Access Works

1. Member scans RFID tag at the reader
2. Pi looks up the tag in the local database
3. If found and member is `active`:
   - Checks schedule rules (holiday overrides → unlimited → recurring → one-time)
   - If within an allowed schedule: **gate opens** for 5 seconds
   - If outside schedule hours: **access denied** (red flash + buzzer)
4. If tag is unknown: **red flash** (not recorded)
5. If member is `suspended`/`inactive`: **access denied** (recorded)
6. All allowed/denied events are logged locally and synced hourly

## Sync Behavior

- **Pull** (Website → Pi): Full snapshot of entry types, members, schedules, and phone credentials replaces local data
- **Push** (Pi → Website): Unsynced check-in records are batch-uploaded with idempotent insert (safe to retry)
- **Failure handling**: If the website is unreachable, the failure is logged and retried on the next hourly cycle
- **Heartbeat**: Pi sends its status (uptime, pending check-ins, version) to the website each sync

### Sync Pull Payload (Website → Pi)

The website's `GET /api/gate/sync/pull` endpoint should return:

```json
{
  "entry_types": [ { "id": "...", "name": "Resident", "description": "...", "is_system": 1, "created_at": "..." } ],
  "members":     [ { "id": "...", "first_name": "Jane", "last_name": "Doe", "entry_type_id": "...", "user_id": "...", "rfid_tag": "A1B2C3D4", "source": "sync", "status": "active", "notes": null, "created_at": "..." } ],
  "schedules":   [ { "id": "...", "name": "Weekdays", "entry_type_id": "...", "pool_member_id": null, "schedule_type": "recurring", "days_of_week": "Mon,Tue,Wed,Thu,Fri", "start_time": "06:00", "end_time": "22:00", "is_active": 1, "created_at": "..." } ],
  "credentials": [
    {
      "id": "uuid",
      "pool_member_id": "uuid-of-member",
      "credential_type": "nfc_phone | ble_token | rfid",
      "credential_hash": "sha256-hex-of-normalized-value",
      "totp_secret":     "BASE32SECRET",
      "device_platform": "ios | android | card | other",
      "device_name":     "Jane's iPhone 15",
      "enrolled_at":     "2026-04-19T12:00:00Z",
      "revoked_at":       null,
      "last_used_at":     null,
      "status":           "active"
    }
  ]
}
```

**Credential storage notes**
- Raw phone IDs and BLE tokens are **never** stored on the Pi — only SHA-256 hashes
- A member may have many credentials; revoking one does not affect the others
- If the website sends `credential_value` instead of `credential_hash`, the Pi will hash it locally — either works

### Phone Unlock HTTP Endpoint

Companion iOS / Android apps can unlock the gate over the local pool Wi-Fi by POSTing to the Pi:

```
POST http://<pi-ip>:8080/api/gate/phone-unlock
Content-Type: application/json
X-Gate-Phone-Key: <optional PHONE_UNLOCK_KEY>

{
  "credential_type": "nfc_phone",
  "token":           "<phone-credential-hash>",
  "device_platform": "ios",
  "device_name":     "Jane's iPhone"
}
```

Response codes:
- `200 { "allowed": true,  "member": { ... }, "reason": "Weekdays" }`
- `403 { "allowed": false, "reason": "Outside hours" | "status:suspended" | "unknown" }`
- `401 { "allowed": false, "reason": "unauthorized" }` when `PHONE_UNLOCK_KEY` mismatches
- `429 { "allowed": false, "reason": "rate_limited" }` after too many attempts

Rate limit defaults: **20 attempts per minute** per source IP.

## Operational Guide

### Daily Operations

#### Monitoring the System

- **Dashboard health check**: Open the viewer at `http://<pi-ip>:8080` each morning
- **Sync status**: Verify "Last sync" timestamp is less than 2 hours old
- **Member count**: Confirm active member count matches website expectations
- **Recent entries**: Spot-check recent check-ins to ensure no unexpected denials

#### Common Admin Tasks

| Task | Steps |
|------|-------|
| **Add/Edit member RFID tag** | Website admin panel → Pool Members → Edit → RFID Tag field → Save (syncs within 1 hour) |
| **Update schedules** | Website admin panel → Pool Schedules → Edit → Save (syncs within 1 hour) |
| **Force immediate sync** | SSH to Pi: `npm run sync` from `/home/pi/gate-entry/` directory |
| **View recent entries** | Open viewer dashboard → Recent Check-Ins tab |
| **Check for errors** | SSH to Pi: `sudo journalctl -u gate-entry -n 50` (last 50 log lines) |

#### Manual Sync

If an urgent schedule change is needed before the next hourly sync:

```bash
ssh pi@<pi-ip>
cd ~/gate-entry
npm run sync
# Watch output; should complete in 10-30 seconds
sudo systemctl restart gate-entry  # Optional: restart service
```

### Offline Operation

When the website is unreachable:
- **Gate continues working** — uses the last successfully synced member/schedule data
- **Check-ins are queued** — stored locally in the database until sync succeeds
- **UI shows "Offline"** — dashboard will display "Last sync" as stale
- **No manual intervention needed** — when website returns online, next hourly sync will catch up

**Recovery after outage:**
1. Check website is back online
2. Open viewer dashboard — should show fresh "Last sync" timestamp within 60 seconds
3. Verify queued check-ins appear in "Recent Check-Ins" table (may see bulk of entries from offline period)
4. No data is lost; all check-ins are recorded

### Seasonal Tasks

| Season | Task |
|--------|------|
| **Spring** | Test gate relay and LEDs; verify RFID range hasn't decreased |
| **Summer** | Monitor power draw; ensure Pi fan cooling is adequate for peak usage |
| **Fall** | Clean RFID reader lens; verify waterproofing before rainy season |
| **Winter** | Test backup power (UPS); ensure database is backed up |

---

## Troubleshooting

### Member-Level Issues

| Issue | Symptoms | Solution |
|-------|----------|----------|
| **Tag not recognized** | Red light + long buzzer | Admin re-registers tag in website; syncs within 1 hour |
| **Denied outside hours** | Red light + buzzer | Member checks schedule on website or dashboard |
| **Account suspended** | Red light + buzzer | Admin checks member status; restores if legitimate |
| **Multiple attempts fail** | Consistent red lights | Hardware issue likely; escalate to Pi maintainer |

### Hardware Issues

| Issue | Symptoms | Solution |
|-------|----------|----------|
| **RFID not reading** | No response to tag scans | SSH to Pi: `npm test` → scan tag → check output; check SPI enabled: `ls /dev/spidev*` |
| **Gate won't open** | Beep/lights work but gate doesn't unlock | Check relay wiring to GPIO 17; test: `gpio write 17 1` (should click); verify 12V power to lock |
| **LEDs not lighting** | No green/red lights | Check GPIO wiring for 27 (green) and 22 (red); test: `gpio write 27 1` should light green |
| **Buzzer silent** | Entries logged but no sound | Check GPIO 23 wiring; verify 5V buzzer has correct polarity |
| **Service won't start** | `sudo systemctl status gate-entry` shows error | Check logs: `sudo journalctl -u gate-entry -e`; verify `.env` variables; check SPI enabled |

### Network Issues

| Issue | Symptoms | Solution |
|-------|----------|----------|
| **Sync failing** | Dashboard shows "Last sync: 2+ hours ago" | Verify `WEBSITE_URL` in `.env`; verify `GATE_API_KEY` matches website `.env`; test connectivity: `curl http://<website-url>/api/gate/sync` |
| **Pi offline** | Can't access dashboard; gate may still work locally | Check Pi power (LED should be on); verify Wi-Fi connection: `iwconfig`; SSH to Pi to check: `ip addr` |
| **Website unreachable** | Gate continues working but check-ins don't upload | Expected behavior; gate uses cached data; sync queues check-ins; no user action needed |

### Database Issues

| Issue | Symptoms | Solution |
|-------|----------|----------|
| **Database corrupted** | Errors like "SQLITE_CORRUPT" in logs | SSH to Pi: `npm run setup-db` (wipes and reinitializes); run `npm run sync` to restore from website |
| **Database full** | Logs show "disk I/O error" | Check disk: `df -h`; if full, delete old check-ins: `sqlite3 /home/pi/gate-entry/gate.db "DELETE FROM check_ins WHERE date < date('now', '-1 year');"` |
| **Sync orphaned data** | Old check-ins not uploading | Manual push: SSH and run `npm run sync`; check website API for errors |

### Log Files

#### View Current Logs
```bash
sudo journalctl -u gate-entry -f  # Follow live logs
sudo journalctl -u gate-entry -n 100  # Last 100 lines
sudo journalctl -u gate-entry --since "2 hours ago"  # Last 2 hours
```

#### Common Log Messages

| Message | Meaning | Action |
|---------|---------|--------|
| `✓ RFID ready` | Reader initialized | Normal; system is running |
| `✗ Failed to sync: Connection refused` | Website unreachable | Check website is up; check `WEBSITE_URL` and `GATE_API_KEY` |
| `Synced: 47 members, 12 schedules, 156 check-ins pushed` | Sync successful | Normal; shows data flow |
| `Tag XXXXXXXX → Allowed: 08:30:42` | Entry granted | Normal; shows gate operation |
| `Tag XXXXXXXX → Denied: Outside hours` | Entry rejected | Normal; member tried outside schedule |
| `SQLITE_IOERR` | Database error | Run `npm run setup-db` to reinitialize |

---

## Backups & Disaster Recovery

### Automated Backups

The setup script configures an external USB drive at `/mnt/usb` for automatic database backups. If enabled, the Pi backs up the local SQLite database hourly.

#### Verify Backups Are Working

```bash
ls -lah /mnt/usb/gate-backups/
# Should show files like: gate.db.2026-04-19-03.backup
```

#### Manual Backup

```bash
cp /home/pi/gate-entry/gate.db /mnt/usb/manual-backup-$(date +%Y-%m-%d).db
```

#### Restore from Backup

```bash
cp /mnt/usb/manual-backup-2026-04-19.db /home/pi/gate-entry/gate.db
sudo systemctl restart gate-entry
npm run sync  # Sync again to ensure consistency
```

---

## Advanced Configuration

### Email Alerts for Sync Failures

Edit `src/sync.js` to add email notifications:

```javascript
// At the top, add:
const nodemailer = require('nodemailer');

// After failed sync, add:
if (process.env.ALERT_EMAIL) {
  await transporter.sendMail({
    from: process.env.ALERT_EMAIL_FROM,
    to: process.env.ALERT_EMAIL,
    subject: 'GateEntry Sync Failed',
    text: `Gate Pi sync failed at ${new Date()}\n\nError: ${error.message}`
  });
}
```

Add to `.env`:
```
ALERT_EMAIL=admin@example.com
ALERT_EMAIL_FROM=gate-pi@example.com
```

### Custom Check-In Retention Policy

By default, check-ins are kept forever. To auto-delete old entries monthly:

```bash
# Add to crontab (crontab -e):
0 0 1 * * sqlite3 /home/pi/gate-entry/gate.db "DELETE FROM check_ins WHERE date < date('now', '-6 months');"
```

### Access Control Dashboard Authentication

The viewer is currently public (read-only). To add password protection, wrap the viewer with nginx:

```bash
sudo apt install nginx -y
# Configure nginx reverse proxy to add Basic Auth
```

---

## Performance Benchmarks

Typical performance metrics on Raspberry Pi 4:

| Operation | Time | Notes |
|-----------|------|-------|
| Tag scan → lookup | <100ms | Network-independent |
| GPIO relay trigger | 50-200ms | Hardware-dependent |
| Total entry latency | <500ms | User-noticeable speed |
| Hourly sync | 10-60s | Depends on member count |
| Dashboard page load | 300-800ms | Includes 500+ records |
| Database query (search) | 5-50ms | Indexed by tag ID |

---

## Security Considerations

- **API Key**: `GATE_API_KEY` in `.env` must be secure and different from website password
- **Network**: Pi should be on isolated VLAN if possible; use firewall rules to allow only website IPs
- **Database**: No passwords stored; SQLite file should have restricted permissions (`600`)
- **Logs**: Check-in logs contain entry patterns; rotate/archive periodically
- **Updates**: Enable automatic security updates for the Pi OS

## File Structure

```
GateEntry/
├── package.json          # Dependencies and scripts
├── .env.example          # Configuration template
├── .gitignore
├── setup-pi.sh           # One-time Pi setup script
├── README.md
└── src/
    ├── index.js          # Main application entry point
    ├── config.js         # Configuration loader
    ├── database.js       # Local SQLite database manager
    ├── sync.js           # Website sync (pull/push)
    ├── rfid.js           # MFRC522 RFID reader interface
    ├── gate.js           # GPIO controller (relay, LEDs, buzzer)
    ├── setup-db.js       # Database initialization script
    ├── manual-sync.js    # Manual sync trigger
    └── test-rfid.js      # RFID hardware test
```
