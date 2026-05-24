# GateEntry `.env` Configuration Reference

The Pi gate controller is configured entirely through environment variables loaded from `GateEntry/.env`. A template is provided at `GateEntry/.env.example` — copy it to `.env` (the setup script does this automatically) and edit the values described below.

```bash
cp GateEntry/.env.example GateEntry/.env
nano GateEntry/.env
```

---

## Quick-start: minimal working `.env`

For the typical RS485-USB reader + SD-card storage setup, this is all you need:

```env
WEBSITE_URL=http://192.168.1.50:3000
GATE_API_KEY=<paste-generated-64-char-key>

DB_PATH=/home/pi/gateentry-data/gate.db
DEVICE_ID=gate-pool-main

RELAY_PIN=17
LED_GREEN_PIN=27
LED_RED_PIN=22
BUZZER_PIN=23

GATE_OPEN_DURATION_MS=5000
SYNC_INTERVAL_MS=3600000

READER_TYPE=serial
SERIAL_PORT=/dev/ttyUSB0
SERIAL_BAUD=9600
SERIAL_DELIMITER=crlf

VIEWER_HOST=0.0.0.0
VIEWER_PORT=8080
PHONE_UNLOCK_KEY=
```

---

## Website connection

### `WEBSITE_URL`
Public URL of the HOA website **as the Pi sees it** (no trailing slash).

| Scenario | Value |
|----------|-------|
| Website on same Pi | `http://localhost:3000` |
| Website on another LAN host | `http://192.168.1.50:3000` |
| Website hosted publicly | `https://hoa.example.com` |

### `GATE_API_KEY`
Shared secret that authenticates the Pi to the website's `/api/gate/*` endpoints. The Pi sends it in the `X-Gate-API-Key` HTTP header; the website rejects requests with the wrong key (`403`).

**Generate a strong key:**
```bash
# On the Pi:
openssl rand -hex 32
```
```powershell
# On a Windows dev machine:
[Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

**Set the same value on the website:**
- Local dev (PowerShell): `$env:GATE_API_KEY="<key>"; node server.js`
- Linux/systemd: add `Environment=GATE_API_KEY=<key>` to the unit file
- Cloud host: set `GATE_API_KEY` in the app's environment-variable settings, then restart

**Verify match from the Pi:**
```bash
curl -H "X-Gate-API-Key: <your-key>" http://<website-host>/api/gate/sync/pull
```
JSON back = match. `403` = mismatch.

---

## Database

### `DB_PATH`
Full path to the local SQLite file. The directory is created automatically if it doesn't exist.

| Storage option | Recommended path |
|----------------|------------------|
| External USB drive (best for write longevity) | `/mnt/usb/gateentry/gate.db` |
| SD card, user home | `/home/pi/gateentry-data/gate.db` |
| SD card, system location | `/var/lib/gateentry/gate.db` |

> **Tip**: SQLite + WAL does many small writes. On low-quality SD cards, prefer a USB drive for long-term deployments.

---

## Device identity

### `DEVICE_ID`
Short unique label used in heartbeat logs and the website's gate-status display. Must be unique across all gates if you ever deploy more than one.

Examples: `gate-pool-main`, `gate-pool-side`, `gate-clubhouse-01`.

---

## GPIO pins (BCM numbering)

Run `pinout` on the Pi to see the physical layout. These default values match the wiring in [README.md](../README.md). If you don't have a particular component wired, leaving the pin set is harmless — nothing draws current until the code drives the pin.

| Variable | Default | Controls |
|----------|---------|----------|
| `RELAY_PIN` | `17` | Relay that releases the magnetic lock |
| `LED_GREEN_PIN` | `27` | "Ready / access granted" LED |
| `LED_RED_PIN` | `22` | "Denied" LED |
| `BUZZER_PIN` | `23` | Active buzzer (audible feedback) |

> **Conflict warning**: GPIO 22 and 23 are also the default RST/SCK lines for the SPI MFRC522 reader. If you use `READER_TYPE=mfrc522` (not the RS485 path), move the LED and buzzer to other pins (e.g. `LED_RED_PIN=5`, `BUZZER_PIN=6`).

---

## Timing

### `GATE_OPEN_DURATION_MS`
How long the relay stays released after a valid scan, in milliseconds.

| Value | Meaning |
|-------|---------|
| `3000` | Snappy re-lock |
| `5000` | **Default** — comfortable for most users |
| `8000` | Generous (children, mobility-assistive devices) |

### `SYNC_INTERVAL_MS`
Interval between full sync cycles (pull members/schedules, push check-ins).

| Value | Meaning |
|-------|---------|
| `60000` | 1 min — useful while testing |
| `3600000` | **Default** — 1 hour |
| `86400000` | 24 hr — very low-traffic gates only |

The gate continues to operate fully offline between syncs, so longer intervals don't affect responsiveness — only how quickly admin-side changes propagate to the Pi.

---

## RFID reader

### `READER_TYPE`
Which reader backend to use.

| Value | Use when |
|-------|----------|
| `serial` | RS485-USB or any USB-serial reader |
| `mfrc522` | MFRC522 module wired directly to GPIO/SPI |
| `auto` | Try MFRC522 first, then serial, then simulation |

### MFRC522 (SPI) options — only used when `READER_TYPE=mfrc522`

| Variable | Default | Notes |
|----------|---------|-------|
| `SPI_BUS` | `0` | SPI bus index |
| `SPI_DEVICE` | `0` | Chip-select line |

### Serial options — only used when `READER_TYPE=serial`

#### `SERIAL_PORT`
Path to the USB-RS485 adapter.

```bash
ls -l /dev/serial/by-id/        # preferred — stable across reboots
ls /dev/ttyUSB*                 # fallback
dmesg | tail -20                # see which driver attached (ch341, ftdi_sio, cp210x)
```

| Type | Example |
|------|---------|
| Stable by-id path (preferred) | `/dev/serial/by-id/usb-1a86_USB_Serial-if00-port0` |
| Generic | `/dev/ttyUSB0` |

#### `SERIAL_BAUD`
Baud rate the reader transmits at. Common values: `9600`, `19200`, `38400`, `115200`. Check the reader's manual or test with:
```bash
sudo apt-get install -y minicom
sudo minicom -D /dev/ttyUSB0 -b 9600
```
Tap a card; readable digits/hex = correct baud, garbage = try the next value.

#### `SERIAL_DELIMITER`
How the reader frames each scan.

| Value | Reader emits |
|-------|--------------|
| `crlf` | UID followed by `\r\n` (most common) |
| `cr` | UID followed by `\r` |
| `lf` | UID followed by `\n` |
| `stx-etx` | UID wrapped in `0x02 ... 0x03` (Wiegand-to-RS485 bridges) |

> **Permission note**: The user running the gate service must be in the `dialout` group to open serial devices.
> ```bash
> sudo usermod -aG dialout $USER
> sudo usermod -aG dialout root      # the service runs as root
> ```

---

## Read-only Pi dashboard

### `VIEWER_HOST`
Network interface the dashboard listens on.

| Value | Meaning |
|-------|---------|
| `0.0.0.0` | **Default** — accessible from any LAN host at `http://<pi-ip>:8080` |
| `127.0.0.1` | Pi-local only (use SSH tunnel to access remotely) |

### `VIEWER_PORT`
TCP port for the dashboard. Default `8080`. Change only if another service already uses that port.

### `VIEWER_ADMIN_KEY`
Optional shared key for the Fire tablet live monitor scan feed.

When set, the Pi requires this key before returning data from:

- `/api/viewer/events`
- `/api/viewer/live-scans`

If this value is blank but `PHONE_UNLOCK_KEY` is set, the live monitor uses `PHONE_UNLOCK_KEY` as its shared key. Open the tablet page with `?gate_key=<key>` once, or enter the key when the tablet prompts for it.

---

## Phone access (optional)

### `PHONE_UNLOCK_KEY`
Pre-shared key required by the `/api/gate/phone-unlock` endpoint when a companion phone app POSTs an unlock request. Sent by the app as header `X-Gate-Phone-Key` or body field `gate_key`.

Leave **blank** to disable the check (or to skip phone-app integration entirely). Setting a value does not affect card scans through the RS485 reader.

---

## Verifying the configuration

After editing `.env`, do a dry-run:
```bash
cd ~/HOAManager/GateEntry
node src/index.js
```

Healthy startup prints:
```
✓ Local database initialized at <DB_PATH>
✓ GPIO initialized (relay=17, green=27, red=22, buzzer=23)
✓ Serial RFID reader open on /dev/ttyUSB0 @ 9600 (crlf)
✓ Serial polling started (debounce 3000ms)
✓ Periodic sync enabled (every 60 minutes)
```

Any line showing `⚠ ... simulation mode` or `✗ Failed to open ...` points back to the variable that needs fixing — usually `SERIAL_PORT`, `SERIAL_BAUD`, `WEBSITE_URL`, or `GATE_API_KEY`.

`Ctrl+C` to stop the dry-run, then start the service:
```bash
sudo systemctl restart gate-entry
sudo journalctl -u gate-entry -f
```
