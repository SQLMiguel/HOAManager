// ─── Gate Hardware Controller ───────────────────────────
// Controls the magnetic lock relay, LEDs, and buzzer via GPIO.
//
// On a real Raspberry Pi, this uses the onoff library for GPIO.
// On non-Pi systems, it logs actions to the console instead.

const config = require('./config');

let Gpio;
let relay = null;
let ledGreen = null;
let ledRed = null;
let buzzer = null;
let isSimulated = false;
let gateOpenTimeout = null;

function init() {
  try {
    Gpio = require('onoff').Gpio;

    // Relay controls the magnetic lock (HIGH = locked, LOW = unlocked)
    // Using active-low relay module: write 0 to energize (unlock)
    relay = new Gpio(config.relayPin, 'out');
    relay.writeSync(1); // Start locked

    ledGreen = new Gpio(config.ledGreenPin, 'out');
    ledRed = new Gpio(config.ledRedPin, 'out');
    buzzer = new Gpio(config.buzzerPin, 'out');

    // Green LED on = system ready
    ledGreen.writeSync(1);
    ledRed.writeSync(0);
    buzzer.writeSync(0);

    isSimulated = false;
    console.log('  ✓ GPIO initialized (relay=' + config.relayPin +
      ', green=' + config.ledGreenPin +
      ', red=' + config.ledRedPin +
      ', buzzer=' + config.buzzerPin + ')');
  } catch (e) {
    isSimulated = true;
    console.log('  ⚠ GPIO not available — gate hardware simulated');
  }
}

// ── Gate Actions ────────────────────────────────────────

function openGate(durationMs) {
  const duration = durationMs || config.gateOpenDurationMs;

  if (gateOpenTimeout) {
    clearTimeout(gateOpenTimeout);
  }

  if (isSimulated) {
    console.log(`  🔓 [SIM] Gate OPEN (${duration}ms)`);
    gateOpenTimeout = setTimeout(() => {
      console.log('  🔒 [SIM] Gate LOCKED');
      gateOpenTimeout = null;
    }, duration);
    return;
  }

  // Release magnetic lock
  relay.writeSync(0);

  // Green LED blink pattern
  ledGreen.writeSync(0);
  setTimeout(() => ledGreen.writeSync(1), 200);
  setTimeout(() => ledGreen.writeSync(0), 400);
  setTimeout(() => ledGreen.writeSync(1), 600);

  // Short buzzer beep
  buzzer.writeSync(1);
  setTimeout(() => buzzer.writeSync(0), 300);

  // Re-lock after duration
  gateOpenTimeout = setTimeout(() => {
    relay.writeSync(1); // Lock
    ledGreen.writeSync(1); // Steady green = ready
    gateOpenTimeout = null;
  }, duration);
}

function denyAccess() {
  if (isSimulated) {
    console.log('  🚫 [SIM] Access DENIED — red flash + buzzer');
    return;
  }

  // Red LED flash pattern
  ledRed.writeSync(1);
  setTimeout(() => ledRed.writeSync(0), 200);
  setTimeout(() => ledRed.writeSync(1), 400);
  setTimeout(() => ledRed.writeSync(0), 600);
  setTimeout(() => ledRed.writeSync(1), 800);
  setTimeout(() => ledRed.writeSync(0), 1200);

  // Two short buzzer beeps = denied
  buzzer.writeSync(1);
  setTimeout(() => buzzer.writeSync(0), 150);
  setTimeout(() => buzzer.writeSync(1), 300);
  setTimeout(() => buzzer.writeSync(0), 450);
}

function unknownTag() {
  if (isSimulated) {
    console.log('  ❓ [SIM] Unknown RFID tag — red flash');
    return;
  }

  // Single long red flash
  ledRed.writeSync(1);
  setTimeout(() => ledRed.writeSync(0), 1500);

  // Single long buzz
  buzzer.writeSync(1);
  setTimeout(() => buzzer.writeSync(0), 800);
}

// ── Cleanup ─────────────────────────────────────────────

function cleanup() {
  if (gateOpenTimeout) clearTimeout(gateOpenTimeout);

  if (!isSimulated) {
    // Ensure gate is locked on shutdown
    if (relay) { relay.writeSync(1); relay.unexport(); }
    if (ledGreen) { ledGreen.writeSync(0); ledGreen.unexport(); }
    if (ledRed) { ledRed.writeSync(0); ledRed.unexport(); }
    if (buzzer) { buzzer.writeSync(0); buzzer.unexport(); }
  }

  console.log('  ✓ GPIO cleaned up, gate locked');
}

module.exports = {
  init,
  openGate,
  denyAccess,
  unknownTag,
  cleanup,
  isSimulated: () => isSimulated
};
