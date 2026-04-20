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
const viewer = require('./viewer');
const scanHandler = require('./scanHandler');

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

// 5. Start read-only viewer for local database visibility
const viewerServer = viewer.startViewer();

// ── Unified Scan Handler ───────────────────────────────
// Same pipeline for physical cards, iPhone NFC Wallet passes,
// Android HCE tags, BLE tokens, and QR codes (static + rolling TOTP).
// Implementation lives in ./scanHandler so the phone-unlock HTTP
// endpoint (see viewer.js) can reuse the exact same logic.

function handleRfidScan(tagId) {
  // The MFRC522 reader returns a UID regardless of whether the source
  // is a physical card, an Apple Wallet NFC pass, or an Android HCE tag.
  // lookupByCredential('rfid', ...) internally also checks nfc_phone.
  return scanHandler.handleScan('rfid', tagId, {
    source: 'rfid-reader',
    device_platform: 'card'
  });
}

// Expose the unified handler to other modules (e.g., phone unlock HTTP endpoint).
module.exports = { handleScan: scanHandler.handleScan };

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

  // Stop viewer server
  if (viewerServer && typeof viewerServer.close === 'function') {
    try { viewerServer.close(); } catch (_) {}
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
