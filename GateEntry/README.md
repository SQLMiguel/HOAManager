# Glenridge Pool Gate Entry Controller

Raspberry Pi-based RFID gate entry system for the Glenridge Community pool. Replaces the existing gate controller with a Pi that reads RFID tags, validates access against a local database, and releases the magnetic gate lock.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Raspberry Pi                         │
│                                                         │
│  RFID Tag ──→ MFRC522 Reader ──→ Local DB Lookup (<2s) │
│                                       │                 │
│                                  Schedule Check         │
│                                       │                 │
│                              ┌────────┴────────┐       │
│                           Allowed           Denied      │
│                              │                 │        │
│                        Open Relay         Flash Red     │
│                       (unlock gate)       + Buzzer      │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Hourly Sync                         │   │
│  │  Website ──→ Pull members/schedules ──→ Local DB │   │
│  │  Local DB ──→ Push check-in logs ──→ Website     │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Key Features

- **Fast response**: RFID lookup against local SQLite database — under 2 seconds
- **Offline operation**: If the website is unreachable, the gate continues working using cached data
- **Bi-directional sync**: Pulls pool members/schedules from website hourly; pushes check-in logs back
- **Holiday support**: Holiday schedules override regular schedules for that date
- **Idempotent sync**: Check-in push uses UUIDs to prevent duplicates on retry

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
| `npm start` | Start the gate controller |
| `npm test` | Test RFID reader hardware |
| `npm run sync` | Force a manual sync with the website |
| `npm run setup-db` | Initialize/reset the local database |

## Assigning RFID Tags

RFID tags are assigned to pool members through the admin panel on the website:

1. Go to **Admin Panel → 🏊 Pool Management → Pool Members**
2. Click **Edit** on a member
3. Enter their RFID tag ID in the **RFID Tag** field
4. Save — the tag will sync to the Pi on the next hourly cycle

To find a tag's ID, run `npm test` and scan the tag.

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

- **Pull** (Website → Pi): Full snapshot of entry types, members, and schedules replaces local data
- **Push** (Pi → Website): Unsynced check-in records are batch-uploaded with idempotent insert (safe to retry)
- **Failure handling**: If the website is unreachable, the failure is logged and retried on the next hourly cycle
- **Heartbeat**: Pi sends its status (uptime, pending check-ins, version) to the website each sync

## Troubleshooting

| Issue | Solution |
|-------|----------|
| RFID not reading | Check SPI enabled: `ls /dev/spidev*` — reboot if needed |
| Gate won't open | Check relay wiring; verify GPIO pin matches `.env` |
| Sync failing | Check `WEBSITE_URL` and `GATE_API_KEY` in `.env` |
| Database errors | Run `npm run setup-db` to reinitialize |
| Service won't start | Check logs: `sudo journalctl -u gate-entry -e` |

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
