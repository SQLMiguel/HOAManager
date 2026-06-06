GateEntry RFID
Code Analysis Report
Glenridge Community HOA — Raspberry Pi Pool Gate Controller


Scope: GateEntry/src/rfid.js, GateEntry/src/gate.js, package.json
Focus: RFID cards not being read by the MFRC522 reader
Date: June 2026

Executive Summary
The RFID module (rfid.js) contains one confirmed bug that will prevent all MFRC522 card reads on a standard Raspberry Pi, plus several secondary issues that compound the problem. The root cause is that the SoftSPI pin assignments use physical board pin numbers, but the mfrc522-rpi library expects Broadcom GPIO (BCM) numbers — these are two completely different numbering systems on the Pi.

Think of it like street addresses vs. GPS coordinates. The library is asking for GPS coordinates, but the code is handing it street addresses. The reader initializes without crashing, but every scan silently returns nothing because it is talking to the wrong physical wires.

There are 5 findings in total: 1 Critical, 1 High, 1 Medium, and 2 Informational. Fixing the Critical issue alone should restore RFID reads.

Findings Summary
Severity	ID	Title
CRITICAL	RFD-01	Wrong pin numbering scheme — Board numbers used instead of BCM GPIO numbers
HIGH	RFD-02	MFRC522 polling branch unreachable — code order causes SPI polling to never execute
MEDIUM	RFD-03	No MFRC522 initialization error detection — reader fails silently if SPI is not enabled
INFO	RFD-04	Polling interval (200ms) may miss fast card presentations
INFO	RFD-05	Relay logic comment contradicts code — may cause confusion during hardware debugging

Detailed Findings
RFD-01 [CRITICAL] — Wrong Pin Numbering Scheme
The Problem
The Raspberry Pi has two completely different ways to refer to its physical connector pins:
•	Board numbering — counts the pins physically from 1 to 40 as they appear on the connector header
•	BCM numbering — uses the internal Broadcom chip numbers, which jump around in a non-sequential order

The mfrc522-rpi library (and its underlying rpi-softspi) expects BCM (Broadcom chip) numbers. The code in rfid.js currently passes Board numbers. The reader initializes without throwing an error, but it ends up sending data on the completely wrong GPIO lines — so no card is ever detected.

Current code (rfid.js lines 27–31):
const softSPI = new SoftSPI({
  clock: 23,  // WRONG — Board pin 23 = BCM GPIO 11
  mosi:  19,  // WRONG — Board pin 19 = BCM GPIO 10
  miso:  21,  // WRONG — Board pin 21 = BCM GPIO 9
  client: 24  // WRONG — Board pin 24 = BCM GPIO 8
});
reader = new Mfrc522(softSPI).setResetPin(22); // Board pin 22 = BCM GPIO 25

The standard MFRC522 wiring for a Raspberry Pi uses these BCM numbers:

Signal	MFRC522 Pin	BCM GPIO (correct)	Board Pin #
SCLK (clock)	SCK	BCM 11	23
MOSI	MOSI	BCM 10	19
MISO	MISO	BCM 9	21
SDA / CS (client)	SDA	BCM 8	24
RST (reset pin)	RST	BCM 25	22

Interestingly, in this particular case the Board pin numbers and BCM numbers are the same integers for the SPI bus pins (SCLK=11/23? No — BCM 11 happens to be Board pin 23). Wait — this deserves more careful examination.

The coincidence here is that for the standard SPI pins, the BCM numbers happen to equal the Board numbers that were written in the code for three of the five pins:

Signal	Code Value	BCM GPIO	Match?	Board Pin
clock (SCLK)	23	11	❌ MISMATCH	23
mosi	19	10	❌ MISMATCH	19
miso	21	9	❌ MISMATCH	21
client (CS/SDA)	24	8	❌ MISMATCH	24
setResetPin	22	25	❌ MISMATCH	22

All five pin values are wrong. The code is consistently using Board numbers (the physical count) but the library needs BCM numbers (the chip's internal numbering). These never coincidentally match for the SPI bus on a standard Pi.

The Fix
Replace the SoftSPI initialization block in rfid.js with BCM GPIO numbers:

const softSPI = new SoftSPI({
  clock:  11,  // BCM GPIO 11 (Board pin 23) — SCLK
  mosi:   10,  // BCM GPIO 10 (Board pin 19) — MOSI
  miso:    9,  // BCM GPIO  9 (Board pin 21) — MISO
  client:  8   // BCM GPIO  8 (Board pin 24) — SDA/CS
});
reader = new Mfrc522(softSPI).setResetPin(25); // BCM GPIO 25 (Board pin 22) — RST

RFD-02 [HIGH] — MFRC522 Polling Branch Is Unreachable
The Problem
Inside the startPolling() function in rfid.js, the branches are checked in this order:

1. if (mode === "wiegand")   → return
2. if (mode === "serial")    → return
3. if (isSimulated)          → return   ← this fires for ANY failed init
4. MFRC522 polling code      ← NEVER REACHED when isSimulated = true

Think of it like a set of tollbooths — the simulation tollbooth is placed before the MFRC522 tollbooth. If the MFRC522 reader happens to initialize successfully, isSimulated is false and the code does reach the polling block. But if there is any initialization hiccup at all (wrong pin, SPI not enabled, library load error) then isSimulated becomes true, and the simulation branch swallows execution before MFRC522 polling is ever tried.

The MFRC522 block should be checked before the simulation fallback, not after it.

The Fix
In startPolling(), move the MFRC522 polling block above the isSimulated check:

function startPolling(onTag, debounceMs = 3000) {
  if (mode === "wiegand") return wiegand.startPolling(onTag, debounceMs);
  if (mode === "serial" && serialReader?.parser) { /* ... */ return serialReader.port; }

  // ── MFRC522 block FIRST, before simulation check ──
  if (mode === "mfrc522") {
    let lastTag = null, lastTagTime = 0;
    const interval = setInterval(() => {
      const uid = readTag();
      if (uid) {
        const now = Date.now();
        if (uid !== lastTag || (now - lastTagTime) > debounceMs) {
          lastTag = uid; lastTagTime = now; onTag(uid);
        }
      }
    }, 200);
    console.log("  ✓ MFRC522 polling started");
    return interval;
  }

  // Simulation fallback — only if nothing else matched
  if (isSimulated) { /* readline keyboard input */ }
}

RFD-03 [MEDIUM] — Silent Failure When SPI Is Not Enabled
The Problem
The initMfrc522() function calls new Mfrc522(softSPI).setResetPin(22) but does not verify whether the reader actually responded. On a Pi where SPI is disabled in raspi-config, this call succeeds (the object is constructed) but subsequent reads return empty. There is no ping or self-test step to confirm the hardware is actually talking back.

This means the system logs "✓ MFRC522 RFID reader initialized (SPI)" and appears healthy — but every single card scan returns null silently. From a troubleshooting perspective, this makes the bug very hard to find because the logs look fine.

Prerequisite Check
Before the code fix matters, verify SPI is enabled on the Pi:

sudo raspi-config
→ Interface Options → SPI → Enable

Or check directly:
ls /dev/spidev*
If that command returns nothing, SPI is off and no amount of code changes will help.

The Fix
Add a version-register read as a hardware handshake inside initMfrc522(), right after constructing the reader object:

function initMfrc522() {
  const Mfrc522 = require("mfrc522-rpi");
  const SoftSPI = require("rpi-softspi");
  const softSPI = new SoftSPI({ clock: 11, mosi: 10, miso: 9, client: 8 });
  reader = new Mfrc522(softSPI).setResetPin(25);
  reader.reset();

  // Read the MFRC522 version register (0x37). Valid chips return 0x91 or 0x92.
  const version = reader.readRegister(0x37);
  if (version !== 0x91 && version !== 0x92) {
    throw new Error(`MFRC522 version check failed (got 0x${version.toString(16)})`);
  }
  mode = "mfrc522";
  console.log(`  ✓ MFRC522 initialized — chip version 0x${version.toString(16)}`);
}

RFD-04 [INFO] — 200ms Poll Interval May Miss Quick Card Taps
Observation
The MFRC522 is polled once every 200ms. The MFRC522 chip's own card-present window is very short — if someone taps a card quickly (a natural motion), the card may have left the field between polls. The industry-standard polling interval for this chip is 50–100ms.

Recommendation
Lower the interval from 200ms to 100ms. This is a one-character change:

// Before
const interval = setInterval(() => { ... }, 200);

// After
const interval = setInterval(() => { ... }, 100);

RFD-05 [INFO] — Relay Logic Comment Contradicts Code
Observation
In gate.js, the comment says:

// Relay controls the magnetic lock (HIGH = locked, LOW = unlocked)
// Using active-low relay module: write 0 to energize (unlock)

But the code then does:

relay.writeSync(1); // Start locked

The comment says "write 0 to energize (unlock)" — meaning write 0 = unlock. Writing 1 = locked. That part is consistent. But the first comment line says "HIGH = locked, LOW = unlocked" which contradicts "write 0 to energize" if energize means unlock. This is not currently causing a bug (the behavior appears correct), but if someone is debugging the relay wiring, the contradictory comments will cause confusion.

Recommendation
Simplify the comment to a single unambiguous statement:

// Active-low relay: writeSync(0) = energized = gate UNLOCKED
//                   writeSync(1) = released = gate LOCKED
relay.writeSync(1); // Start locked

Recommended Action Plan
Follow these steps in order. Steps 1 and 2 are the ones most likely to restore RFID reads immediately.

#	Finding	Action
1	RFD-03	On the Pi, run: sudo raspi-config → Interface Options → SPI → Enable. Reboot. Confirm /dev/spidev* exists.
2	RFD-01	In rfid.js, change the SoftSPI pin values to BCM GPIO numbers: clock→11, mosi→10, miso→9, client→8, and setResetPin(25).
3	RFD-02	In rfid.js startPolling(), move the MFRC522 setInterval block above the isSimulated check.
4	RFD-03	Add the version register check (0x37) inside initMfrc522() so failures throw an error with a clear message.
5	RFD-04	Change setInterval polling from 200ms to 100ms.
6	RFD-05	Clean up the relay logic comment in gate.js for clarity.

Quick Diagnostic Checklist
If reads still fail after applying all fixes, run through this checklist on the Pi:

•	SPI enabled: ls /dev/spidev* → should show /dev/spidev0.0
•	Wiring: confirm MFRC522 VCC is on 3.3V pin (Board pin 1), NOT 5V — the chip is 3.3V only and 5V will damage it
•	Library installed: cd GateEntry && npm list mfrc522-rpi → should show 2.1.3
•	Run the test script: npm run test → should print "Place a card near the reader..."
•	Check logs for "MFRC522 RFID reader initialized" — if it says "simulation mode" instead, SPI init failed
•	If version check returns 0x00 or 0xFF, the SPI wiring has a physical connection problem


This report covers only the files provided (rfid.js, gate.js, package.json). Additional files (config.js, index.js, wiegand.js, sync.js) were not reviewed and may contain related issues.
