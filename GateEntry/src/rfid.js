// ─── RFID Reader Module ─────────────────────────────────
// Supports three reader backends, selected via config.readerType:
//   'wiegand' — EP1501 Wiegand reader via GPIO (D0/D1 edge detection)
//   'serial'  — RS485/USB serial reader on /dev/ttyUSB* (ASCII line protocol)
//   'auto'    — try wiegand first, then serial, else simulation
//
// On a desktop with no hardware, falls back to keyboard simulation.
//
// NOTE: A legacy MFRC522 (SPI/SoftSPI) backend was removed. The mfrc522-rpi /
// rpi-softspi libraries rely on the bcm2835/sysfs GPIO interface, which does not
// work on the Raspberry Pi 5 (RP1 GPIO) — it silently falls back to a mock mode
// and never reads cards. The production gate uses the Wiegand (EP1501) reader.

const config = require('./config');
const wiegand = require('./wiegand');
const fs = require('fs');

let serialReader = null;
let isSimulated = false;
let mode = 'simulated'; // 'wiegand' | 'serial' | 'simulated'

function initWiegand() {
  wiegand.init();
  mode = 'wiegand';
}

function initSerial() {
  if (!fs.existsSync(config.serialPort)) {
    throw new Error(`serial port ${config.serialPort} does not exist`);
  }

  // Lazy require so dev machines without serialport installed still boot.
  const { SerialPort, ReadlineParser, DelimiterParser } = require('serialport');

  const port = new SerialPort({
    path: config.serialPort,
    baudRate: config.serialBaud,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    autoOpen: false
  });

  // Choose a parser based on configured delimiter.
  let parser;
  const delim = config.serialDelimiter;
  if (delim === 'stx-etx') {
    // Many Wiegand-to-RS485 bridges frame UID between STX (0x02) and ETX (0x03).
    parser = port.pipe(new DelimiterParser({ delimiter: Buffer.from([0x03]) }));
  } else {
    const eol = delim === 'cr' ? '\r' : delim === 'lf' ? '\n' : '\r\n';
    parser = port.pipe(new ReadlineParser({ delimiter: eol }));
  }

  port.open((err) => {
    if (err) {
      console.error(`  ✗ Failed to open ${config.serialPort}: ${err.message}`);
      serialReader = null;
      mode = 'simulated';
      isSimulated = true;
      console.log('  [WARN] Serial reader disabled - running in simulation mode');
      return;
    }
    console.log(`  ✓ Serial RFID reader open on ${config.serialPort} @ ${config.serialBaud} (${delim})`);
  });

  serialReader = { port, parser };
  mode = 'serial';
}

function init() {
  const want = config.readerType;
  const tryOrder = want === 'wiegand' ? ['wiegand']
                 : want === 'serial'  ? ['serial']
                 : ['wiegand', 'serial']; // 'auto'

  for (const m of tryOrder) {
    try {
      if (m === 'wiegand')     initWiegand();
      else if (m === 'serial') initSerial();
      isSimulated = false;
      return;
    } catch (e) {
      console.log(`  · ${m} reader unavailable: ${e.message}`);
    }
  }

  isSimulated = true;
  mode = 'simulated';
  console.log('  ⚠ No hardware reader available — running in simulation mode');
  console.log('    Type an RFID tag ID and press Enter to simulate a scan');
}

// Normalize a raw UID string from a serial reader into uppercase hex.
function normalizeSerialTag(raw) {
  if (raw == null) return '';
  let s = String(raw).trim();
  // Strip STX, control chars, surrounding whitespace.
  s = s.replace(/[\x00-\x1F\x7F]/g, '').trim();
  // Many readers emit "0012345678" decimal. If it's all digits, keep as-is;
  // otherwise uppercase any hex.
  if (/^[0-9A-Fa-f:\-\s]+$/.test(s)) {
    s = s.replace(/[:\-\s]/g, '').toUpperCase();
  }
  return s;
}

function startPolling(onTag, debounceMs = 3000) {
  // ── Wiegand (EP1501 GPIO) ──────────────────────────────
  if (mode === 'wiegand') {
    return wiegand.startPolling(onTag, debounceMs);
  }

  // ── Serial / RS485-USB ─────────────────────────────────
  if (mode === 'serial' && serialReader && serialReader.parser) {
    let lastTag = null;
    let lastTagTime = 0;
    serialReader.parser.on('data', (chunk) => {
      const tag = normalizeSerialTag(chunk);
      if (!tag) return;
      const now = Date.now();
      if (tag !== lastTag || (now - lastTagTime) > debounceMs) {
        lastTag = tag;
        lastTagTime = now;
        onTag(tag);
      }
    });
    serialReader.port.on('error', (err) => {
      console.error('  ✗ Serial port error:', err.message);
    });
    console.log(`  ✓ Serial polling started (debounce ${debounceMs}ms)`);
    return serialReader.port;
  }

  // ── Simulation (keyboard) ──────────────────────────────
  if (isSimulated) {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '' });
    rl.on('line', (line) => {
      const tag = line.trim();
      if (tag) onTag(tag);
    });
    console.log('  → Simulation mode: enter RFID tag IDs via keyboard');
    return rl;
  }

  return null;
}

function isSimulationMode() {
  return isSimulated;
}

module.exports = {
  init,
  startPolling,
  isSimulationMode
};
