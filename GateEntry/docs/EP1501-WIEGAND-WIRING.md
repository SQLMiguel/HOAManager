# EP1501 → Raspberry Pi Wiegand Wiring Guide

This document describes how to tap the Wiegand data lines on a Mercury Security
**EP1501** intelligent controller and feed them into a Raspberry Pi so the Pi
can validate cards/credentials against the online HOA database while the EP1501
continues to operate normally.

The Pi listens **in parallel** with the EP1501 — the existing reader, wiring,
and gate logic are not disturbed.

---

## 1. Parts Needed

| Qty | Part | Notes |
|-----|------|-------|
| 1 | TXS0108E 8-channel level shifter breakout | ~$3, common Amazon/AliExpress part |
| ~10 | Male-to-female jumper wires | Pi header → level shifter |
| 1 | Short length of 3-conductor wire | T-splice from EP1501 to level shifter |
| 1 | Wago lever connectors or wire nuts (optional) | If TB2 screw terminals can't hold a second wire |
| 1 | Multimeter | For continuity checks before power-on |

> The USB-to-RS485 adapter is **not used** for this wiring. RS-485 is
> electrically incompatible with Wiegand signaling.

---

## 2. EP1501 Terminal Reference (TB2 — Reader 1 Port)

From the EP1501 Installation Manual:

| Terminal | Label | Function | Used in this guide? |
|----------|-------|----------|---------------------|
| TB2-1 | VO | +12 Vdc reader power (150 mA) | No — **do not connect to Pi** |
| TB2-2 | LED | Reader LED control | No |
| TB2-3 | BZR | Reader buzzer control | No |
| TB2-4 | CLK | Wiegand **Data 1 (D1)** | ✅ Yes |
| TB2-5 | DAT | Wiegand **Data 0 (D0)** | ✅ Yes |
| TB2-6 | GND | Reader Ground | ✅ Yes |

> If your reader is wired in **Clock/Data (mag-stripe) mode** instead of
> Wiegand, the same two pins carry CLK + serial DATA. The decoder module
> handles both — confirm signaling type after first capture.

---

## 3. TXS0108E Level Shifter Layout

The breakout has two 10-pin rows. One side is low voltage (Pi), the other is
high voltage (EP1501).

```
        ┌──────────────────────────────┐
LOW ──► │ VA  GND  A1 A2 A3 ... A8  OE │ ◄── Pi side (3.3V)
SIDE    │                              │
HIGH ──►│ VB  GND  B1 B2 B3 ... B8     │ ◄── EP1501 side (5V)
        └──────────────────────────────┘
```

- **A side = 3.3 V** (Pi)
- **B side = 5 V** (EP1501 reader bus)
- Channels are paired: A1↔B1, A2↔B2, …
- **OE must be tied to VA** for the chip to be enabled.

---

## 4. Raspberry Pi Header Pins Used

```
 Pin 1   3.3V        Pin 2   5V
 Pin 6   GND
 Pin 9   GND
 Pin 11  GPIO 17     Pin 13  GPIO 27
```

---

## 5. Wiring — Step by Step

### Step 1 — Power the level shifter from the Pi

| From | To |
|------|----|
| Pi pin 1 (3.3 V) | TXS0108E **VA** |
| Pi pin 2 (5 V)   | TXS0108E **VB** |
| Pi pin 6 (GND)   | TXS0108E **GND** (either GND pin) |
| TXS0108E **VA**  | TXS0108E **OE** (jumper together to enable the chip) |

### Step 2 — Connect Pi GPIOs to the A (low-voltage) side

| From | To |
|------|----|
| Pi pin 11 (GPIO 17) | TXS0108E **A1** |
| Pi pin 13 (GPIO 27) | TXS0108E **A2** |

### Step 3 — T-splice the EP1501 reader lines to the B (high-voltage) side

At the EP1501's TB2 terminal block, the existing reader wires stay in place.
Add a second wire to each of the three terminals below (most screw terminals
hold two wires; otherwise use a Wago lever connector or wire nut to splice).

| EP1501 terminal | Existing wire | New tap wire goes to |
|-----------------|---------------|----------------------|
| TB2-4 (CLK / D1) | (reader) | TXS0108E **B2** |
| TB2-5 (DAT / D0) | (reader) | TXS0108E **B1** |
| TB2-6 (GND)      | (reader) | Pi pin 9 (GND)  |

> ⚠️ **Critical:** EP1501 GND connects **directly** to Pi GND, not through the
> level shifter. The level shifter handles the two data lines only; GND must
> be a shared reference between both boards.

---

## 6. Wiring Diagram

> ### ⚠️ Signal Direction is One-Way: EP1501 → Pi
>
> The two Wiegand data lines are **driven by the reader** (which is already
> wired into TB2-4 and TB2-5). The Pi only **listens**. Configure GPIO 17 and
> GPIO 27 as **inputs** in software. Never drive these GPIOs as outputs — doing
> so would conflict with the reader and can corrupt card reads or damage the
> reader's output stage.
>
> Only **D0, D1, and GND** are tapped from the EP1501.
> **Do NOT** wire TB2-1 (VO/12 V), TB2-2 (LED), or TB2-3 (BZR) to the Pi.

```
   ┌──────────── EP1501 TB2 ────────────┐
   │  TB2-4 (CLK / D1) ───┐             │  arrows show signal direction
   │  TB2-5 (DAT / D0) ───┤             │  (reader drives the line, Pi reads)
   │  TB2-6 (GND)      ───┤             │
   └──────────────────────┼─────────────┘
                          │  tap each one in parallel with the reader
                          ▼
                    ┌──────────────┐
                    │  TXS0108E    │
   TB2-4 ──────────►┤ B2  ⇄  A2    ├──────► Pi GPIO 27 (pin 13)  [INPUT]
   TB2-5 ──────────►┤ B1  ⇄  A1    ├──────► Pi GPIO 17 (pin 11)  [INPUT]
                    │              │
        Pi 5V  ────►┤ VB           │
                    │          VA  │◄──── Pi 3.3V (pin 1)
                    │          OE  │◄──── jumper to VA (enables chip)
        Pi GND ────►┤ GND          │
                    │              │
                    │   B5..B8     │   (unused channels — leave open)
                    │   A5..A8     │
                    └──────────────┘

   EP1501 TB2-6 GND ─────────────────────► Pi GND (pin 9)  [DIRECT, not via shifter]

   TB2-1 (VO 12 V)   ✗ not connected
   TB2-2 (LED)       ✗ not connected
   TB2-3 (BZR)       ✗ not connected
```

### Channel pairing summary

| EP1501 line | TXS0108E B-side | TXS0108E A-side | Pi GPIO   | Header pin |
|-------------|-----------------|-----------------|-----------|------------|
| TB2-5 (D0)  | B1              | A1              | GPIO 17   | 11         |
| TB2-4 (D1)  | B2              | A2              | GPIO 27   | 13         |
| TB2-6 (GND) | —               | —               | GND       | 9 (direct) |

---

## 7. Pre-Power Verification (multimeter, all power OFF)

Before applying power, check continuity:

- ✅ EP1501 TB2-6 has continuity to Pi GND.
- ✅ TXS0108E VA reads continuity to Pi 3.3 V pin.
- ✅ TXS0108E VB reads continuity to Pi 5 V pin.
- ✅ TXS0108E OE is tied to VA.
- ❌ **No** continuity between Pi 3.3 V and Pi 5 V.
- ❌ **No** continuity between any data line (D0, D1) and GND or VCC.

---

## 8. Power-On Test

1. Power up the Raspberry Pi first.
2. Power up (or leave running) the EP1501.
3. On the Pi, observe GPIO 17 and 27:

   ```bash
   # Bookworm / Raspberry Pi OS 12+
   pinctrl get 17
   pinctrl get 27

   # Older releases
   gpio readall
   ```

4. Both lines should idle **HIGH (1)**.
5. Tap a card on the EP1501 reader. You should see brief drops to **0** on
   one or both lines (Wiegand: alternating pulses on D0 and D1).

If both lines remain stuck high or stuck low after a card tap, recheck:

- TB2-6 ↔ Pi GND connection (most common failure)
- OE jumpered to VA on the level shifter
- A1↔B1 / A2↔B2 are paired correctly (not crossed)

---

## 9. Software

Once GPIOs 17 and 27 reliably toggle on a card tap, the gate controller is ready. The Wiegand decoder (`GateEntry/src/wiegand.js`) handles this automatically:

- Listens for falling edges on GPIO 17 (D0) and GPIO 27 (D1) using the `onoff` library
- Assembles 26- or 34-bit Wiegand frames (frame end detected by 50 ms of silence)
- Strips leading/trailing parity bits and returns an uppercase hex card ID
- Feeds the card UID into the existing scan handler (`GateEntry/src/scanHandler.js`), reusing the current access-check and database validation flow

Set `READER_TYPE=wiegand` in your `.env` file (this is the default). No changes to the EP1501's own configuration or firmware are required.

**Card ID format:** The decoded UID is the hex representation of the data bits (parity stripped):
- Wiegand 26 → 24 data bits → 6 hex chars, e.g. `007B1234`
- Wiegand 34 → 32 data bits → 8 hex chars

When enrolling a card in the admin panel, tap the card at the gate first (check the Pi console output for the hex ID), then enter that value as the member's RFID tag.
