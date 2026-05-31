// Wiegand GPIO Decoder
// Decodes Wiegand 26- and 34-bit card reads from the EP1501 reader
// via GPIO using the onoff library.
//
// Wiring (per docs/diagrams/gate-access-wiring.mmd):
//   EP1501 TB2-5 (DAT / D0) -> HY-M154 IN1 ->[opto]-> V1 -> GPIO 17 (INPUT, pull-up)
//   EP1501 TB2-4 (CLK / D1) -> HY-M154 IN2 ->[opto]-> V2 -> GPIO 27 (INPUT, pull-up)
//
// The HY-M154 (817) board outputs are open-collector, so GPIO17/GPIO27 are
// configured as inputs WITH INTERNAL PULL-UP to supply the idle HIGH level.
//
// NOTE - the 817 board INVERTS the raw Wiegand signal: the reader idles HIGH
// and pulses LOW, but after the optocoupler the Pi sees idle LOW / pulse HIGH.
// If no bits decode during the bench test, switch the watch edge below from
// 'falling' to 'rising' (the data-bit edge is inverted by the opto).
//
// Protocol (at the reader, before the inverting opto):
//   Both lines idle HIGH.
//   Falling edge on D0 = bit '0'; falling edge on D1 = bit '1'.
//   A frame ends after FRAME_TIMEOUT_MS of silence.
//   Parity bits (first and last) are stripped; the remaining data
//   bits are returned as an uppercase hex string.
//
//   Wiegand 26 -> 24 data bits -> 6 hex chars  e.g. "007B1234"
//   Wiegand 34 -> 32 data bits -> 8 hex chars

const config = require('./config');
const { execFileSync, spawn } = require('child_process');

let Gpio;
let d0 = null;
let d1 = null;
let available = false;
let backend = 'onoff';
let pollProcesses = [];

const FRAME_TIMEOUT_MS = 50; // ms of silence = end of frame
const MAX_BITS = 64;         // reject noise bursts longer than this

function commandExists(command) {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function configureInputPullup(pin) {
  execFileSync('pinctrl', ['set', String(pin), 'ip', 'pu'], { stdio: 'ignore' });
}

function isLowTransition(line) {
  const text = String(line || '').toLowerCase();
  if (/\b(hi|high)\b/.test(text) || /\|\s*1\b/.test(text)) return false;
  if (/\b(lo|low)\b/.test(text) || /\|\s*0\b/.test(text)) return true;
  // Some pinctrl versions only print that an event occurred. Treat those as
  // valid so older output formats still work, but explicitly ignore high lines
  // above to avoid double-counting Wiegand pulse release edges.
  return true;
}

// Convert an array of bit values (0/1) into an uppercase hex string.
// Parity bits (index 0 and last) are stripped before conversion.
function decodeFrame(bits) {
  const len = bits.length;
  if (len < 4) return null; // too short to be a real card

  // Strip leading and trailing parity bits (standard W26/W34/W35/W37).
  const dataBits = bits.slice(1, len - 1);

  let value = 0n;
  for (const b of dataBits) {
    value = (value << 1n) | BigInt(b);
  }

  // Pad to full hex nibbles (e.g. 24 bits -> 6 chars, 32 bits -> 8 chars).
  const hexLen = Math.ceil(dataBits.length / 4);
  return value.toString(16).padStart(hexLen, '0').toUpperCase();
}

function init() {
  try {
    Gpio = require('onoff').Gpio;

    // Enable the internal pull-ups first. The HY-M154 (817) outputs are
    // open-collector and can only pull LOW, so GPIO17/GPIO27 need an internal
    // pull-up to read a stable idle HIGH. onoff (sysfs) cannot set bias, so use
    // pinctrl when present - best effort, never fatal.
    if (commandExists('pinctrl')) {
      try {
        configureInputPullup(config.wiegandD0Pin);
        configureInputPullup(config.wiegandD1Pin);
      } catch (_) { /* pull-up is best effort; continue with onoff watchers */ }
    }

    // GPIO direction must be 'in'; never drive D0/D1 as outputs -
    // the EP1501 reader drives these lines.
    d0 = new Gpio(config.wiegandD0Pin, 'in', 'falling', { debounceTimeout: 0 });
    d1 = new Gpio(config.wiegandD1Pin, 'in', 'falling', { debounceTimeout: 0 });

    backend = 'onoff';
    available = true;
    console.log(
      `  [OK] Wiegand decoder initialized` +
      ` (D0=GPIO${config.wiegandD0Pin}, D1=GPIO${config.wiegandD1Pin})`
    );
    return;
  } catch (err) {
    cleanup();

    if (!commandExists('pinctrl')) {
      throw err;
    }

    try {
      configureInputPullup(config.wiegandD0Pin);
      configureInputPullup(config.wiegandD1Pin);
    } catch (_) {
      throw err;
    }

    backend = 'pinctrl';
    available = true;
    console.log(
      `  [OK] Wiegand decoder initialized with pinctrl fallback` +
      ` (D0=GPIO${config.wiegandD0Pin}, D1=GPIO${config.wiegandD1Pin})`
    );
  }
}

function startPolling(onTag, debounceMs = 3000) {
  if (!available) throw new Error('Wiegand not initialized');

  let bits = [];
  let frameTimer = null;
  let lastTag = null;
  let lastTagTime = 0;

  function processFrame() {
    const captured = bits.slice();
    bits = [];
    frameTimer = null;

    if (captured.length > MAX_BITS) return; // noise - discard

    const tag = decodeFrame(captured);
    if (!tag) return;

    const now = Date.now();
    if (tag !== lastTag || (now - lastTagTime) > debounceMs) {
      lastTag = tag;
      lastTagTime = now;
      onTag(tag);
    }
  }

  function onBit(bit) {
    return (err) => {
      if (err) return;
      bits.push(bit);
      if (bits.length > MAX_BITS) {
        // Overflow - discard and reset
        bits = [];
        if (frameTimer) { clearTimeout(frameTimer); frameTimer = null; }
        return;
      }
      if (frameTimer) clearTimeout(frameTimer);
      frameTimer = setTimeout(processFrame, FRAME_TIMEOUT_MS);
    };
  }

  if (backend === 'onoff') {
    d0.watch(onBit(0));
    d1.watch(onBit(1));
  } else {
    pollProcesses = [
      startPinctrlPoll(config.wiegandD0Pin, 0, onBit),
      startPinctrlPoll(config.wiegandD1Pin, 1, onBit)
    ];
  }

  console.log(
    `  [OK] Wiegand polling started` +
    ` (D0=GPIO${config.wiegandD0Pin}, D1=GPIO${config.wiegandD1Pin},` +
    ` debounce ${debounceMs}ms)`
  );

  return {
    close() {
      if (frameTimer) { clearTimeout(frameTimer); frameTimer = null; }
      try { d0.unwatch(); d0.unexport(); } catch (_) {}
      try { d1.unwatch(); d1.unexport(); } catch (_) {}
      stopPinctrlPollers();
    }
  };
}

function startPinctrlPoll(pin, bit, onBit) {
  let stopped = false;
  let child = null;

  function start() {
    child = spawn('pinctrl', ['poll', String(pin)], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (data) => {
      const lines = String(data).split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        if (/waiting|timeout/i.test(line)) continue;
        if (!isLowTransition(line)) continue;
        onBit(bit)(null);
      }
    });

    child.stderr.on('data', (data) => {
      const message = String(data).trim();
      if (message) console.error(`  pinctrl poll GPIO${pin}: ${message}`);
    });

    child.on('exit', () => {
      if (!stopped) setTimeout(start, 250);
    });
  }

  start();

  return {
    close() {
      stopped = true;
      if (child && !child.killed) child.kill('SIGTERM');
    }
  };
}

function stopPinctrlPollers() {
  for (const poller of pollProcesses) {
    try { poller.close(); } catch (_) {}
  }
  pollProcesses = [];
}

function cleanup() {
  try { if (d0) { d0.unwatch(); d0.unexport(); d0 = null; } } catch (_) {}
  try { if (d1) { d1.unwatch(); d1.unexport(); d1 = null; } } catch (_) {}
  stopPinctrlPollers();
}

module.exports = {
  init,
  startPolling,
  cleanup,
  isAvailable: () => available
};
