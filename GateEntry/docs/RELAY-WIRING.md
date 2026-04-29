# Relay Wiring — `RELAY_PIN=17`

How the Pi's GPIO 17 controls the magnetic lock through a relay module.

## What `RELAY_PIN=17` does

The Pi's GPIO 17 is a digital output (3.3 V logic) that drives the **control input of a relay module**. The relay is an electrically-isolated switch that can pass the much higher current (12 V/24 V, several amps) needed to power a magnetic lock or strike. The Pi never touches the lock's power circuit directly — it just tells the relay "open" or "closed."

```
┌────────┐  3.3V signal   ┌─────────┐   12V switched   ┌──────────┐
│  Pi    │  ───GPIO 17───►│  Relay  │ ────NO contact──►│ Mag-lock │
│        │                │ Module  │                  │          │
│   GND  │ ──────GND─────►│         │◄──── 12V PSU ────│          │
└────────┘                └─────────┘                  └──────────┘
```

## What you need

| Item | Notes |
|------|------|
| 1-channel 5 V relay module with opto-isolation | "SRD-05VDC-SL-C" boards are common (~$3). Has 3 input pins (VCC/GND/IN) + 3 output pins (COM/NO/NC) |
| 12 V (or 24 V) DC power supply | Sized for your magnetic lock (typical lock = 12 V @ 0.5 A) |
| Magnetic lock or electric strike | Whatever the gate uses |
| Female-to-female jumper wires | For Pi-to-relay signal wiring |
| Short hookup wire | For the lock-side power loop |
| 1N4007 flyback diode | If the lock's datasheet doesn't confirm one is built in |
| 10 kΩ resistor | Optional pull-up from GPIO 17 to 3.3 V for fail-secure on a floating pin |

## How the code uses GPIO 17

From [src/gate.js](../src/gate.js):

| Step | Code | Electrical effect |
|------|------|------|
| 1. App start | `relay = new Gpio(17, 'out'); relay.writeSync(1);` | Pin driven HIGH (3.3 V). On an active-LOW relay module, that **de-energizes** the coil → contacts in default state (NO=open) → **lock engaged** |
| 2. Valid scan | `relay.writeSync(0);` | Pin driven LOW (0 V). Relay coil energizes → COM connects to NO → 12 V flows to the lock → **lock releases** |
| 3. Timer expires after `GATE_OPEN_DURATION_MS` (5 s) | `relay.writeSync(1);` | Pin back HIGH → relay drops out → **lock re-engages** |
| 4. Shutdown / crash | `relay.writeSync(1); relay.unexport();` | Pin re-asserted HIGH so the gate **always fails locked** |

> "Active-LOW" is the default behavior of the cheap blue/green Chinese relay modules. If your relay is active-HIGH, swap the values: write `1` to release, `0` to lock. You'll know it's wrong if the gate sits unlocked when the Pi boots and locks during scans.

## Step-by-step wiring (active-LOW relay, fail-secure mag-lock)

### Step 1 — Power off everything
Unplug the Pi and the 12 V supply. Don't work on a live mag-lock circuit.

### Step 2 — Wire the Pi → relay control side (3 wires, low voltage)

| Pi pin | Physical pin # | Relay input | Purpose |
|--------|---------------|-------------|---------|
| 5 V | 2 (or 4) | **VCC** | Powers the relay coil. Some 3.3 V-tolerant modules accept 3.3 V — check the silkscreen. |
| GND | 6 (or 9, 14, 20…) | **GND** | Common ground |
| **GPIO 17** | **11** | **IN / IN1 / SIG** | Control signal |

> Use Pi physical pin **11** for GPIO 17. (BCM 17 ≠ pin 17 on the header — don't confuse them. Run `pinout` on the Pi to confirm.)

### Step 3 — Identify the relay output terminals
The screw-terminal block on the relay has three contacts labeled:
- **COM** — common
- **NO** — normally open (not connected to COM until relay activates)
- **NC** — normally closed (connected to COM until relay activates)

### Step 4 — Wire the lock circuit (high-voltage side)

For a **fail-secure mag-lock** (locks on power — standard pool-gate setup), use **NO** so power only flows when access is granted:

```
12V PSU (+)  ───────────►  COM  on relay
NO  on relay ───────────►  Mag-lock (+)
Mag-lock (–) ───────────►  12V PSU (–)
```

For a **fail-safe** lock (unlocks when powered — used where code requires the gate to open during a fire alarm), use **NC** instead. Most pool gates are fail-secure; confirm with your lock's manual.

### Step 5 — Add a flyback diode if your relay module doesn't have one
Magnetic coils kick back voltage when de-energized. Almost all pre-made relay modules include this protection on the **coil** side. The **lock** itself also has a coil — add a 1N4007 diode across the lock terminals (band toward `+`) if the lock's datasheet doesn't say one is built in. Skipping this can fry the relay contacts over time.

### Step 6 — Common-ground sanity check
The Pi's GND, the relay module's GND, and the 12 V supply's negative line do **not** need to be tied together for an opto-isolated module — that's the whole point of opto-isolation. If your relay module has a `JD-VCC` jumper, **leave it on its default position** unless you're explicitly powering the coil from a separate supply.

### Step 7 — Power-on order
1. Plug in the 12 V supply for the lock — lock should be **engaged** (silent click, magnet active).
2. Power up the Pi.
3. As the gate-entry service starts, `gate.init()` drives GPIO 17 HIGH → relay stays de-energized → lock stays engaged. You should hear nothing.
4. The green LED steady on = system ready.

### Step 8 — Bench test before mounting
With the lock not yet attached to the door, run:
```bash
cd ~/HOAManager/GateEntry
node src/index.js
```
Tap a known card. You should hear a distinct **click** from the relay module (LED on the module lights up) for 5 seconds, then another click as it re-locks. If that works, the wiring is correct.

If the relay clicks but the lock doesn't release, swap NO ↔ NC. If the relay doesn't click at all, double-check physical pin 11 (GPIO 17) and that the module's VCC has 5 V.

### Step 9 — Failure-mode behaviors to verify
- **Pi crashes mid-cycle**: The `uncaughtException` handler in [src/index.js](../src/index.js) keeps the process alive. Even on a hard crash, GPIO 17 floats — add a **pull-up resistor (10 kΩ) from GPIO 17 to 3.3 V** so a floating pin still reads HIGH and keeps the lock engaged.
- **Power loss to the Pi**: The 12 V supply is independent, so the lock stays engaged. (Fail-secure.)
- **Power loss to the lock supply**: The lock disengages. Add a small UPS to the 12 V supply if your community requires the gate to remain locked through outages.

### Step 10 — Mount and dress the cabling
Keep the 3.3 V Pi-side wiring physically separated from the 12 V lock-side wiring; route them through different cable glands if possible. Strain-relief everything with cable ties so a tug on the lock cable doesn't yank the relay module loose.

---

If the relay clicks correctly during the bench test in Step 8, the rest is just plumbing — the code never needs to know what's on the other side of the relay.
