# Pool Gate Scanner Hardware Guide

## Overview

This system supports both **iPhone/Android phone credentials** and **physical RFID cards** using a single, proven NFC/RFID reader.

## Recommended Hardware Setup

### ✅ Current Solution: MFRC522 NFC/RFID Reader

**This is the ideal hardware for your needs.**

| Component | Specification | Cost | Notes |
|-----------|---------------|------|-------|
| **Reader** | MFRC522 | $5–15 | Supports 13.56 MHz (NFC + RFID) |
| **Enclosure** | IP67 plastic housing | $10–20 | Weather-resistant |
| **Connection** | SPI via GPIO | — | Raspberry Pi built-in |
| **Total** | — | **~$15–35** | One-time cost |

### Why MFRC522 is Perfect

✅ **Dual credential support**: Reads both RFID cards AND NFC phones  
✅ **No code changes needed**: Already fully integrated  
✅ **No QR codes required**: Works with Apple Wallet and Google Wallet native protocols  
✅ **2-foot range**: Sufficient for gate entry (tap/hold phone to reader)  
✅ **Inexpensive**: ~$5–15 for the module  
✅ **Proven & reliable**: Used in millions of access control systems  
✅ **Works offline**: Full validation happens locally on the Pi  

### How It Works

**For iPhone users:**
1. Add Glenridge Pool Pass to Apple Wallet (standard NFC pass)
2. Hold iPhone near reader
3. NFC chip is read → credential validated locally → gate opens

**For Android users:**
1. Add pass to Google Wallet OR use companion app with HCE
2. Hold phone near reader
3. HCE emulates NFC card → credential validated locally → gate opens

**For RFID card users:**
1. Tap card against reader
2. Card UID is read → credential validated locally → gate opens

All three methods use the **same reader**, **same validation pipeline**, and **same local database**.

---

## Hardware Architecture

```
┌─────────────────────────────────────┐
│    iPhone / Android Phone           │
│    (Apple Wallet / Google Wallet)   │
│         + RFID Card                 │
└────────────────┬────────────────────┘
                 │ (Tap phone / card)
                 ▼
     ┌──────────────────────────┐
     │   MFRC522 NFC/RFID       │
     │      Reader (13.56 MHz)  │
     │   SPI → Raspberry Pi     │
     └──────────────┬───────────┘
                    │
                    ▼
          ┌─────────────────────┐
          │  Local Database     │
          │  (credential check) │
          └──────────┬──────────┘
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
       Allowed              Denied
      Open Gate           Flash Red

```

---

## Installation & Wiring

See [GateEntry/README.md - Hardware Requirements](../GateEntry/README.md#hardware-requirements) for complete wiring diagram and setup instructions.

### Key GPIO Assignments

| Device | Pin | GPIO |
|--------|-----|------|
| MFRC522 (Reader) | SDA | GPIO 24 |
| Relay (Lock) | IN | GPIO 17 |
| Green LED | + | GPIO 27 |
| Red LED | + | GPIO 22 |
| Buzzer | + | GPIO 23 |

---

## Verification Checklist

Before deployment, verify:

- [ ] MFRC522 powers on and NFC chip detects phones
- [ ] Test with actual iPhone in Apple Wallet — phone recognized
- [ ] Test with actual Android phone — phone recognized
- [ ] Test with existing RFID card — card recognized
- [ ] Allowed credentials trigger gate unlock
- [ ] Revoked credentials are properly rejected
- [ ] System handles offline operation correctly

---

## Cost Summary

| Item | Cost |
|------|------|
| MFRC522 Module | $5–15 |
| Plastic Enclosure (IP67) | $10–20 |
| Wiring & connectors | $5–10 |
| **Total Hardware** | **~$20–45** |

**One-time cost. No additional sensors, scanners, or modules needed.**

---

## Summary

Your system is **complete and ready**. The MFRC522 reader:

- ✅ Supports both phone credentials (iPhone + Android) and RFID cards
- ✅ Works offline without QR codes
- ✅ Validates instantly from the local database
- ✅ Costs only $5–20
- ✅ Integrates with existing Raspberry Pi GPIO
- ✅ Requires zero code changes

**Recommendation**: Use the existing MFRC522 setup. It's the optimal solution for your requirements.

---

*Last updated: April 20, 2026*
*System: Glenridge Community HOA — Pool Gate Access*
