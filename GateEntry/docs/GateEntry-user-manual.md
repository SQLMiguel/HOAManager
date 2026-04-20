# GateEntry System User Manual

## What is GateEntry?

GateEntry is an intelligent, community-first gate access control system that manages pool entry for Glenridge HOA members. It combines local processing with community data to provide **fast, reliable, and private** gate access without requiring constant internet connectivity.

The system supports multiple credential types, including **iPhone and Android smartphones**, so members can enter with either a physical RFID card or their phone.

## Supported Access Methods

GateEntry accepts any of the following credential types, all validated through the same local database:

| Method | Platforms | How It Works |
|--------|-----------|--------------|
| **RFID Card / Key Fob** | All | Tap a physical tag against the reader |
| **NFC Phone Pass** | iPhone (Apple Wallet) + Android (HCE / Google Wallet) | Hold phone near the reader; NFC chip emulates a card |

| **BLE Token** *(optional hardware)* | iPhone + Android | Phone broadcasts a secure token; gate detects it via Bluetooth |

Every member may have **multiple credentials** enrolled (e.g., one card + one phone), and admins can revoke any individual credential from the website without affecting the others.

## Why Local Database? The Power of Offline-First Design

### The Problem with Traditional Internet-Dependent Gates

Traditional access control systems often require a network request to a central server for every entry attempt:

```
Member Scans Tag → Network Request → Server Check → Response Delay (2-10 seconds)
```

**Challenges:**
- 🔴 **Slow**: Network latency adds 2-10 seconds to every entry
- 🔴 **Internet outages**: Gate becomes unusable when the internet goes down
- 🔴 **Single point of failure**: One server or network issue locks everyone out
- 🔴 **Privacy concerns**: Every entry is immediately transmitted to a central server

### GateEntry's Local-First Approach

GateEntry uses a **local SQLite database** cached on the Raspberry Pi, with scheduled syncs to the community website:

```
Member Scans Tag → Local Database Lookup (<1 second) → Immediate Response
  │
  └─→ Hourly: Sync new members/schedules FROM website
              Sync check-in logs TO website
```

### The Benefits You'll Experience

#### ⚡ **Speed**
- **Access validation in under 1 second** instead of 2-10+ seconds
- No waiting for internet; instant gate response
- Even with 5 people scanning at once, each gets near-instant access

#### 🔐 **Reliability**
- **Gate works during internet outages** — your community stays connected
- If the website goes down for maintenance, the gate continues operating
- Bi-directional sync ensures no lost data when connectivity is restored
- Automatic retry logic means failed syncs don't break anything

#### 🛡️ **Privacy**
- Entry attempts are **logged locally first**, protecting your privacy during transmission
- Check-in data is **batch-uploaded once per hour**, not sent in real-time
- No personal information is stored on the Pi—only ID numbers and schedules
- Internet outages don't expose your access patterns to cloud services

#### 💰 **Cost-Effective**
- Minimal bandwidth usage (only syncs once per hour, not per scan)
- Works on inexpensive Raspberry Pi hardware (~$50-100)
- No monthly subscription fees to a cloud provider
- Community controls the infrastructure

#### 🏘️ **Community-Owned**
- Your data stays within the community network
- No third-party analytics or data collection
- Full transparency: admins can review the local database at any time
- Future-proof: community can upgrade hardware independently

---

## How to Use the Gate

### Basic Entry

You can enter with either a **physical RFID card/fob** or your **iPhone or Android phone**.

#### Option A — RFID Card / Key Fob

1. **Approach the reader** with your RFID tag or key fob
2. **Scan your tag** by holding it in front of the reader (within 2-4 inches)
3. **Wait for a response:**
   - ✅ **Green light + short beep**: Access allowed — gate unlocks for 5 seconds
   - 🔴 **Red light + buzzer**: Access denied — see troubleshooting section

#### Option B — iPhone (Apple Wallet NFC Pass)

1. Open your **Apple Wallet**
2. Select the **Glenridge Pool Pass**
3. Hold the top of your iPhone within 2 inches of the reader
4. Unlock with Face ID / Touch ID if prompted
5. Wait for the green-light confirmation, same as a card scan

**Setup**: Admin emails you a `.pkpass` file or a link to add the pass; tap to install it in Apple Wallet.

#### Option C — Android (Google Wallet / HCE)

1. Open **Google Wallet** or the Glenridge companion app
2. Unlock your phone (PIN / biometric)
3. Hold the back of your phone to the reader
4. Wait for the green-light confirmation

**Setup**: Admin sends an enrollment link that registers the device in Google Wallet or the companion app.

### Understanding Access Responses

| Response | What It Means | Action |
|----------|---------------|--------|
| **Green + Beep** | You're allowed to enter now | Push gate; it's unlocked for 5 seconds |
| **Red Pulse** | Gate not available right now | Check posted hours (schedule page in app) |
| **Red + Buzzer** | Your membership is inactive/suspended | Contact admin to restore access |
| **Red + Long Buzzer** | Tag not found in system | Have admin register your tag (may take up to 1 hour) |
| **No Response** | System is rebooting or hardware issue | Wait 30 seconds and try again |

### Schedules Explained

Your access depends on the **schedule assigned to you**:

#### Schedule Types (checked in order)

1. **Holiday Overrides** — Special hours for holidays (e.g., 8 AM–sunset on July 4th)
   - Example: "4th of July — sunrise to sunset"

2. **Unlimited Access** — 24/7 entry (e.g., HOA board members)
   - Access any time of day or night

3. **Recurring Schedules** — Regular weekly patterns
   - Example: "Monday–Friday, 6 AM–10 PM" or "Weekends, 10 AM–6 PM"

4. **One-Time Schedules** — Single-day or date-range access
   - Example: "Guest pass: June 15, 2026, 2 PM–6 PM"

**How the system picks your access:**
- If today is a holiday with a special override → use that schedule
- Otherwise, if you have 24/7 access → allowed now
- Otherwise, check your recurring schedule for today/time
- Otherwise, check if you have a one-time pass today
- Otherwise → access denied

**Example:** You have recurring access "Sat–Sun, 10 AM–8 PM" and a guest one-time pass for "Wed June 18, 1 PM–3 PM". You can enter:
- Any Saturday 10 AM–8 PM
- Any Sunday 10 AM–8 PM
- Wednesday June 18 between 1 PM–3 PM

---

## Monitoring Your Access via the Dashboard

### Accessing the Dashboard

Ask an admin for the IP address of your community pool gate Pi. Once you have it, open your web browser and navigate to:

```
http://<gate-pi-ip>:8080
```

This opens a **read-only dashboard** where you can see:

### Dashboard Features

#### 📊 **Summary Card**
- Total active members
- Scheduled access time this week
- Recent check-ins (last 24 hours)
- Last sync status (e.g., "Synced 3 minutes ago")

#### 👥 **Members Table**
- Names and status (active/inactive/suspended)
- Search by name or member ID
- Filter by status
- See who is registered in the system

#### 📅 **Schedules Table**
- All scheduled access types (unlimited, recurring, one-time)
- Schedule times and date ranges
- Filter by type (holiday, daily, weekly, etc.)

#### ✅ **Recent Check-Ins**
- Name, date, time, and access result (allowed/denied)
- Search and filter to understand usage patterns
- Verify your own entries were recorded

#### 🔄 **Sync Log**
- Last sync timestamp and status
- Any errors (if website couldn't be reached)
- Historical sync attempts
- Helps diagnose connectivity issues

**Note:** The dashboard is **read-only**. All edits (adding schedules, changing status) happen in the HOA website admin panel and sync automatically.

---

## Frequently Asked Questions

### Q: What if my tag stops working?
**A:** RFID tags degrade over time or can be damaged. Ask an admin to:
1. Update your tag in the website admin panel
2. Wait up to 1 hour for the sync, or
3. Ask the gate maintainer to trigger a manual sync

### Q: Can the gate be locked if the website goes down?
**A:** No. The gate has its own database copy. It keeps operating normally. Once the website is back online, the next hourly sync will synchronize any new member data or check-in logs.

### Q: How often is my schedule updated?
**A:** Changes to your schedule sync **every hour** from the website to the gate's local database. If an admin adds urgent weekend access, it will be live within 60 minutes.

### Q: Why do I need an RFID tag instead of a PIN?
**A:** RFID tags are:
- **Faster** — no typing required
- **Safer** — PINs can be shared; fobs are personal
- **Reliable** — work even in poor lighting
- **Accessible** — no fine motor skills needed
- **Fun** — fits the tech-forward community vibe

### Q: Can I use my iPhone or Android phone instead of a card?
**A:** Yes. You can enroll any combination of:
- **iPhone** via an Apple Wallet NFC pass (just tap your phone to the reader)
- **Android** via Google Wallet or the HOA companion app using NFC (HCE)

Ask the admin to enroll your phone. Enrollment is tied to your member record, so the same access schedule applies.

### Q: If I lose my phone, is my access compromised?
**A:** Credentials are stored as cryptographic hashes on the Pi, not as your account password. Admins can revoke a single device from the website without touching your other credentials. Rolling TOTP codes become useless the moment a credential is revoked.

### Q: Does the phone work if the internet is down?
**A:** Yes. The gate validates phone credentials against the **local** database on the Pi — the same one used for RFID cards — so the internet being down does not block phone-based entry.

### Q: Is my entry logged?
**A:** Yes. All entries (allowed or denied) are logged **locally on the Pi** with timestamp and your ID number. Logs are synced once per hour to the website for historical records. This helps with:
- Resolving disputes about when someone entered
- Monitoring community usage
- Detecting suspicious activity

### Q: Who can see my entry logs?
**A:** Only HOA admins with website access. Entry data is:
- Never shared with third parties
- Not used for anything beyond pool access tracking
- Deleted after the community's data retention policy (ask admin for specifics)

### Q: What if I'm locked out?
**A:** If you believe you should have access but are denied:
1. Take a screenshot of the dashboard showing your membership status
2. Note the time you were denied
3. Contact the admin — they can check the local log on the Pi
4. Provide your member ID and the time stamp

### Q: How does the system handle bad weather or power outages?
**A:** 
- **Bad weather**: RFID readers are weather-sealed. Scanning distance may decrease in heavy rain, but the system continues working.
- **Power outage**: If the Pi loses power, there's no gate access until power is restored. Admins should ensure the Pi has a UPS (battery backup) for critical infrastructure.

---

## Troubleshooting

### "I scanned but nothing happened"
- **Try again** — maybe the reader didn't detect your tag. Hold it 2-4 inches from the reader
- **Check orientation** — some tags are directional; try rotating the fob
- **Wait 30 seconds** — the system may be rebooting; try after a short wait
- **Tell an admin** — there may be a hardware issue with the reader

### "I got a red light every time"
- **Check your schedule** — the dashboard shows your access times
- **Check the time/date** — you may be trying outside your authorized hours
- **Check your status** — the dashboard shows if you're active/inactive/suspended
- **Check your tag** — if the dashboard shows your name but gate denies you, the tag may be unregistered
- **Sync delay** — if an admin just added you, wait up to 1 hour for the sync

### "The dashboard shows I should have access, but the gate denies me"
1. Note the **exact time** you were denied
2. Check the "Recent Check-Ins" table on the dashboard — is your entry logged there?
3. If yes → system recorded it but gate denied you (likely schedule/status mismatch)
4. If no → entry wasn't logged (hardware issue or system glitch)
5. **Report to admin** with time and dashboard screenshot

### "The dashboard says 'Last Sync: 2 hours ago'" 
- The gate and website lost connectivity during the sync
- **Not an emergency** — the gate continues working with its cached database
- Admins will investigate network/power issues
- Next successful sync will update the timestamp

---

## Privacy & Security

### What Data Is Stored Locally?
The Pi's local database contains:
- Member names and IDs (only those you share with admins)
- Your assigned schedules
- Your check-in logs (date/time/allowed-or-denied, credential method used)
- **Hashed** credential values for each enrolled RFID card or phone — never the raw phone ID

**Not stored:**
- Passwords or personal information beyond name/ID
- Financial data
- Contact info (that stays on the website only)

### How Phone Credentials Are Protected
- **SHA-256 hashing**: Phone IDs and BLE tokens are hashed before storage — the raw value cannot be recovered from the database.
- **Per-device revocation**: Admins can revoke just one phone (e.g., a lost iPhone) while leaving your other credentials working.
- **Rate-limiting**: The phone unlock endpoint rejects excessive requests from the same source to prevent brute-force attempts.
- **Optional shared key**: Communities can enable an additional `PHONE_UNLOCK_KEY` that companion apps must include when connecting to the Pi.

### How Is Data Protected?
- **Local database**: SQLite file on the Pi (secured via file permissions)
- **Sync communication**: Uses an API key (secure token) that's different from your website password
- **Privacy in transmission**: Check-in data is batch-uploaded once per hour, not sent in real-time
- **No cloud**: Data never leaves the community's local network except for scheduled syncs

### Can I Request My Data Be Deleted?
Yes. Contact an admin to:
- Remove your check-in history (kept for 6–12 months, depending on community policy)
- Remove your tag registration (immediately; you lose gate access)
- Review what data is stored about you

---

## Community Benefits Summary

| Benefit | Why It Matters |
|---------|---|
| **Fast entry** | No 10-second delays; experience better community flow |
| **Always works** | Even if the internet is down, your access is reliable |
| **Privacy first** | Your entry data is local and batch-synced, not streamed |
| **Community-owned** | No subscriptions; no external companies accessing your data |
| **Transparent** | You can see the dashboard and understand how access rules work |
| **Sustainable** | Low cost and low bandwidth means the community can maintain it long-term |

---

## More Help?

- **Dashboard access issues** → Ask an admin for the Pi IP address
- **Tag not working** → Contact an admin to re-register your RFID tag
- **Questions about your schedule** → Check the website admin panel or ask an admin
- **Hardware issues** (no lights, no sounds) → Contact your community's gate maintainer

---

*Last Updated: April 2026*  
*GateEntry System Documentation*
