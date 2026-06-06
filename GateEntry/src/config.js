// ─── Configuration ──────────────────────────────────────
// Loads environment variables and exports a typed config object.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const config = {
  // Website sync
  websiteUrl: process.env.WEBSITE_URL || 'http://localhost:3000',
  gateApiKey: process.env.GATE_API_KEY || 'change-this-gate-api-key',

  // Local database
  dbPath: process.env.DB_PATH || '/mnt/usb/gateentry/gate.db',

  // Device
  deviceId: process.env.DEVICE_ID || 'gate-pi-001',

  // GPIO pins (BCM numbering)
  // NOTE: GPIO17 and GPIO27 are reserved for Wiegand D0/D1 (inputs from EP1501).
  // Relay, LEDs, and buzzer must use different pins.
  relayPin: parseInt(process.env.RELAY_PIN) || 5,
  ledGreenPin: parseInt(process.env.LED_GREEN_PIN) || 6,
  ledRedPin: parseInt(process.env.LED_RED_PIN) || 13,
  buzzerPin: parseInt(process.env.BUZZER_PIN) || 19,

  // Timing
  gateOpenDurationMs: parseInt(process.env.GATE_OPEN_DURATION_MS) || 5000,
  syncIntervalMs: parseInt(process.env.SYNC_INTERVAL_MS) || 3600000, // 1 hour

  // RFID reader selection: 'wiegand' (EP1501 GPIO) | 'serial' (RS485 USB) | 'auto'
  readerType: (process.env.READER_TYPE || 'auto').toLowerCase(),

  // Wiegand reader pins (BCM numbering) — must match wiring diagram
  // EP1501 DAT/D0 → GPIO17 (Pi pin 11); CLK/D1 → GPIO27 (Pi pin 13)
  wiegandD0Pin: parseInt(process.env.WIEGAND_D0_PIN) || 17,
  wiegandD1Pin: parseInt(process.env.WIEGAND_D1_PIN) || 27,

  // Serial / RS485-USB reader settings
  serialPort: process.env.SERIAL_PORT || '/dev/ttyUSB0',
  serialBaud: parseInt(process.env.SERIAL_BAUD) || 9600,
  // Line delimiter emitted by the reader between scans: 'crlf' | 'cr' | 'lf' | 'stx-etx'
  serialDelimiter: (process.env.SERIAL_DELIMITER || 'crlf').toLowerCase(),

  // Read-only viewer UI (hosted on Raspberry Pi)
  viewerPort: parseInt(process.env.VIEWER_PORT) || 8080,
  viewerHost: process.env.VIEWER_HOST || '0.0.0.0',

  // Standalone card ID reader app (does not open the gate or touch the database)
  cardReaderPort: parseInt(process.env.CARD_READER_PORT) || 8090,
  cardReaderHost: process.env.CARD_READER_HOST || '0.0.0.0',

  // Phone unlock endpoint — optional pre-shared key (leave blank to disable check).
  // Clients must send this in header X-Gate-Phone-Key or body.gate_key.
  phoneUnlockKey: process.env.PHONE_UNLOCK_KEY || '',

  // Optional admin key for live viewer scan data. Defaults to PHONE_UNLOCK_KEY
  // so one shared local key can protect both phone unlocks and tablet monitoring.
  viewerAdminKey: process.env.VIEWER_ADMIN_KEY || process.env.PHONE_UNLOCK_KEY || ''
};

module.exports = config;
