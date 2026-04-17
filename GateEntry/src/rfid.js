// ─── RFID Reader Module ─────────────────────────────────
// Interfaces with the MFRC522 RFID reader connected via SPI.
//
// On a real Raspberry Pi, this uses the mfrc522-rpi library.
// On non-Pi systems (development), it falls back to a simulation
// mode that accepts keyboard input for testing.

const config = require('./config');

let reader = null;
let isSimulated = false;

function init() {
  try {
    // Attempt to load the real MFRC522 library (only works on Raspberry Pi with SPI)
    const Mfrc522 = require('mfrc522-rpi');
    const SoftSPI = require('rpi-softspi');

    const softSPI = new SoftSPI({
      clock: 23,  // SCLK
      mosi: 19,   // MOSI
      miso: 21,   // MISO
      client: 24  // SDA / CS
    });

    reader = new Mfrc522(softSPI).setResetPin(22);
    isSimulated = false;
    console.log('  ✓ MFRC522 RFID reader initialized (hardware SPI)');
  } catch (e) {
    // Fall back to simulation mode for development/testing
    isSimulated = true;
    console.log('  ⚠ RFID hardware not available — running in simulation mode');
    console.log('    Type an RFID tag ID and press Enter to simulate a scan');
  }
}

// Read a single RFID tag. Returns the UID string or null if no card present.
// This is a non-blocking check on hardware; blocks for input in simulation.
function readTag() {
  if (isSimulated) {
    return null; // Simulation reads are handled via stdin in index.js
  }

  // Reset the reader
  reader.reset();

  // Scan for cards
  const response = reader.findCard();
  if (!response.status) return null;

  // Get the card UID
  const uidResponse = reader.getUid();
  if (!uidResponse.status) return null;

  // Convert UID bytes to hex string
  const uid = uidResponse.data
    .slice(0, 4)
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');

  // Stop crypto to allow next read
  reader.stopCrypto();

  return uid;
}

// Continuously poll for RFID tags
// Calls onTag(uid) when a tag is detected
// debounceMs prevents reading the same tag repeatedly
function startPolling(onTag, debounceMs = 3000) {
  if (isSimulated) {
    // In simulation mode, read from stdin
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: ''
    });

    rl.on('line', (line) => {
      const tag = line.trim();
      if (tag) {
        onTag(tag);
      }
    });

    console.log('  → Simulation mode: enter RFID tag IDs via keyboard');
    return rl;
  }

  // Hardware polling loop
  let lastTag = null;
  let lastTagTime = 0;

  const interval = setInterval(() => {
    const uid = readTag();
    if (uid) {
      const now = Date.now();
      // Debounce: ignore same tag within debounce window
      if (uid !== lastTag || (now - lastTagTime) > debounceMs) {
        lastTag = uid;
        lastTagTime = now;
        onTag(uid);
      }
    }
  }, 200); // Poll every 200ms

  console.log('  ✓ RFID polling started (200ms interval, ' + debounceMs + 'ms debounce)');
  return interval;
}

function isSimulationMode() {
  return isSimulated;
}

module.exports = {
  init,
  readTag,
  startPolling,
  isSimulationMode
};
