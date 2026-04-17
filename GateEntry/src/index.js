// ─── Glenridge Pool Gate Entry Controller ───────────────
// Main application for the Raspberry Pi gate controller.
//
// Architecture:
//   RFID scan → Local DB lookup (<2s) → Schedule check → Gate open/deny
//   Hourly sync: Website → Local DB (pull), Local check-ins → Website (push)
//
// If the website is unreachable, the gate continues to function
// using the locally cached database. Check-ins are queued and
// pushed on the next successful sync.

const config = require('./config');
const db = require('./database');
const rfid = require('./rfid');
const gate = require('./gate');
const sync = require('./sync');

const startTime = Date.now();

console.log('');
console.log('═══════════════════════════════════════════');
console.log('  Glenridge Pool Gate Entry Controller');
console.log('  Device: ' + config.deviceId);
console.log('═══════════════════════════════════════════');
console.log('');

// ── Initialize all subsystems ───────────────────────────

// 1. Local database
db.initDb();

// 2. Gate hardware (relay, LEDs, buzzer)
gate.init();

// 3. RFID reader
rfid.init();

// 4. Start periodic sync with website
sync.startPeriodicSync();

// ── RFID Scan Handler ───────────────────────────────────

function handleRfidScan(tagId) {
  const scanStart = Date.now();
  console.log(`\n┌─ RFID Scan: ${tagId}`);

  // Step 1: Look up the tag in local database
  const member = db.lookupByRfid(tagId);

  if (!member) {
    console.log('│  ✗ Unknown RFID tag');
    console.log(`└─ Response time: ${Date.now() - scanStart}ms`);
    gate.unknownTag();

    // Record as denied with unknown tag note
    // We can't record without a member ID, so just log it
    return;
  }

  console.log(`│  Member: ${member.first_name} ${member.last_name} (${member.entry_type_name})`);

  // Step 2: Check if member is active
  if (member.status !== 'active') {
    console.log(`│  ✗ Member status: ${member.status}`);
    console.log(`└─ Response time: ${Date.now() - scanStart}ms`);
    gate.denyAccess();
    db.recordCheckin(member.id, member.entry_type_id, 'denied', false, `Status: ${member.status}`);
    return;
  }

  // Step 3: Check schedule-based access
  const access = db.checkAccess(member);

  if (access.allowed) {
    console.log(`│  ✓ ACCESS GRANTED — ${access.reason}`);
    console.log(`└─ Response time: ${Date.now() - scanStart}ms`);
    gate.openGate();
    db.recordCheckin(member.id, member.entry_type_id, 'allowed', access.isHoliday, access.reason);
  } else {
    console.log(`│  ✗ ACCESS DENIED — ${access.reason}`);
    console.log(`└─ Response time: ${Date.now() - scanStart}ms`);
    gate.denyAccess();
    db.recordCheckin(member.id, member.entry_type_id, 'denied', access.isHoliday, access.reason);
  }
}

// ── Start RFID Polling ──────────────────────────────────

const poller = rfid.startPolling(handleRfidScan, 3000);

// ── Status Report ───────────────────────────────────────

function printStatus() {
  const stats = db.getStats();
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const hours = Math.floor(uptime / 3600);
  const mins = Math.floor((uptime % 3600) / 60);

  console.log('\n── Gate Status ──');
  console.log(`  Uptime: ${hours}h ${mins}m`);
  console.log(`  Active members: ${stats.activeMembers}`);
  console.log(`  RFID tags assigned: ${stats.rfidAssigned}`);
  console.log(`  Pending sync: ${stats.pendingSync} check-in(s)`);
  console.log(`  Last sync: ${stats.lastSync || 'never'}`);
  console.log('─────────────────\n');
}

// Print status every 5 minutes
setInterval(printStatus, 300000);

// ── Graceful Shutdown ───────────────────────────────────

function shutdown(signal) {
  console.log(`\n\n  Received ${signal} — shutting down...`);

  // Stop sync
  sync.stopPeriodicSync();

  // Stop RFID polling
  if (poller && typeof poller.close === 'function') {
    poller.close(); // readline interface
  } else if (poller) {
    clearInterval(poller); // hardware polling interval
  }

  // Lock gate and cleanup GPIO
  gate.cleanup();

  // Close database
  db.close();

  console.log('  ✓ Gate controller stopped safely.\n');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught errors — keep the gate locked and log
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.message);
  console.error(err.stack);
  // Don't exit — keep gate operational
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
  // Don't exit — keep gate operational
});
