// ─── Manual Sync Script ─────────────────────────────────
// Force a sync cycle outside of the normal hourly schedule.
//
// Usage: node src/manual-sync.js

const config = require('./config');
const db = require('./database');
const sync = require('./sync');

async function manualSync() {
  console.log('');
  console.log('  Manual sync with', config.websiteUrl);
  console.log('');

  db.initDb();

  try {
    await sync.runSync();
  } catch (e) {
    console.error('  Sync error:', e.message);
  }

  const stats = db.getStats();
  console.log('  Database stats:');
  console.log('    Active members:', stats.activeMembers);
  console.log('    RFID tags assigned:', stats.rfidAssigned);
  console.log('    Pending check-ins:', stats.pendingSync);
  console.log('');

  db.close();
}

manualSync();
