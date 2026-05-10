// ─── Wiegand GPIO Decoder ───────────────────────────────
// Decodes Wiegand 26- and 34-bit card reads from the EP1501 reader
// via GPIO using the onoff library.
//
// Wiring (per WiringDiagram.png):
//   EP1501 TB2-5 (DAT / D0) → TXS0108E B1→A1 → GPIO 17 (INPUT)
//   EP1501 TB2-4 (CLK / D1) → TXS0108E B2→A2 → GPIO 27 (INPUT)
//
// Protocol:
//   Both lines idle HIGH.
//   Falling edge on D0 = bit '0'; falling edge on D1 = bit '1'.
//   A frame ends after FRAME_TIMEOUT_MS of silence.
//   Parity bits (first and last) are stripped; the remaining data
//   bits are returned as an uppercase hex string.
//
//   Wiegand 26 → 24 data bits → 6 hex chars  e.g. "007B1234"
//   Wiegand 34 → 32 data bits → 8 hex chars

const config = require('./config');

let Gpio;
let d0 = null;
let d1 = null;
let available = false;

const FRAME_TIMEOUT_MS = 50; // ms of silence = end of frame
const MAX_BITS = 64;         // reject noise bursts longer than this

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

  // Pad to full hex nibbles (e.g. 24 bits → 6 chars, 32 bits → 8 chars).
  const hexLen = Math.ceil(dataBits.length / 4);
  return value.toString(16).padStart(hexLen, '0').toUpperCase();
}

function init() {
  Gpio = require('onoff').Gpio;

  // GPIO direction must be 'in'; never drive D0/D1 as outputs —
  // the EP1501 reader drives these lines.
  d0 = new Gpio(config.wiegandD0Pin, 'in', 'falling', { debounceTimeout: 0 });
  d1 = new Gpio(config.wiegandD1Pin, 'in', 'falling', { debounceTimeout: 0 });

  available = true;
  console.log(
    `  ✓ Wiegand decoder initialized` +
    ` (D0=GPIO${config.wiegandD0Pin}, D1=GPIO${config.wiegandD1Pin})`
  );
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

    if (captured.length > MAX_BITS) return; // noise — discard

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
        // Overflow — discard and reset
        bits = [];
        if (frameTimer) { clearTimeout(frameTimer); frameTimer = null; }
        return;
      }
      if (frameTimer) clearTimeout(frameTimer);
      frameTimer = setTimeout(processFrame, FRAME_TIMEOUT_MS);
    };
  }

  d0.watch(onBit(0));
  d1.watch(onBit(1));

  console.log(
    `  ✓ Wiegand polling started` +
    ` (D0=GPIO${config.wiegandD0Pin}, D1=GPIO${config.wiegandD1Pin},` +
    ` debounce ${debounceMs}ms)`
  );

  return {
    close() {
      if (frameTimer) { clearTimeout(frameTimer); frameTimer = null; }
      try { d0.unwatch(); d0.unexport(); } catch (_) {}
      try { d1.unwatch(); d1.unexport(); } catch (_) {}
    }
  };
}

function cleanup() {
  try { if (d0) { d0.unwatch(); d0.unexport(); d0 = null; } } catch (_) {}
  try { if (d1) { d1.unwatch(); d1.unexport(); d1 = null; } } catch (_) {}
}

module.exports = {
  init,
  startPolling,
  cleanup,
  isAvailable: () => available
};
