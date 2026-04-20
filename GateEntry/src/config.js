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
  relayPin: parseInt(process.env.RELAY_PIN) || 17,
  ledGreenPin: parseInt(process.env.LED_GREEN_PIN) || 27,
  ledRedPin: parseInt(process.env.LED_RED_PIN) || 22,
  buzzerPin: parseInt(process.env.BUZZER_PIN) || 23,

  // Timing
  gateOpenDurationMs: parseInt(process.env.GATE_OPEN_DURATION_MS) || 5000,
  syncIntervalMs: parseInt(process.env.SYNC_INTERVAL_MS) || 3600000, // 1 hour

  // SPI for RFID reader
  spiBus: parseInt(process.env.SPI_BUS) || 0,
  spiDevice: parseInt(process.env.SPI_DEVICE) || 0,

  // Read-only viewer UI (hosted on Raspberry Pi)
  viewerPort: parseInt(process.env.VIEWER_PORT) || 8080,
  viewerHost: process.env.VIEWER_HOST || '0.0.0.0',

  // Phone unlock endpoint — optional pre-shared key (leave blank to disable check).
  // Clients must send this in header X-Gate-Phone-Key or body.gate_key.
  phoneUnlockKey: process.env.PHONE_UNLOCK_KEY || ''
};

module.exports = config;
