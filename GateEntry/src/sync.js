// ─── Website Sync Module ────────────────────────────────
// Handles bi-directional sync between the Raspberry Pi and the HOA website.
//
// PULL: Downloads pool_entry_types, pool_members, pool_schedules from the
//       website and replaces local data (full snapshot).
//
// PUSH: Uploads unsynced check-in records to the website in batch.
//       Uses idempotent inserts so retries are safe.
//
// Runs on an hourly interval. If the website is unreachable, logs the
// failure and retries on the next cycle. Local gate operation continues
// uninterrupted using the cached local database.

const fetch = require('node-fetch');
const config = require('./config');
const db = require('./database');

const headers = {
  'Content-Type': 'application/json',
  'X-Gate-API-Key': config.gateApiKey
};

// ── Pull data from website → local DB ───────────────────

async function pullFromWebsite() {
  const url = `${config.websiteUrl}/api/gate/sync/pull`;
  console.log(`  ↓ Pulling pool data from ${config.websiteUrl}...`);

  const res = await fetch(url, { headers, timeout: 30000 });
  if (!res.ok) {
    throw new Error(`Pull failed: HTTP ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const { entry_types, members, schedules, credentials } = data;

  db.replacePoolData(entry_types || [], members || [], schedules || [], credentials || []);

  const pulled = (entry_types?.length || 0)
    + (members?.length || 0)
    + (schedules?.length || 0)
    + (credentials?.length || 0);
  console.log(`  ✓ Pulled ${entry_types?.length || 0} types, ${members?.length || 0} members, ${schedules?.length || 0} schedules, ${credentials?.length || 0} phone credentials`);

  return pulled;
}

// ── Push check-ins from local DB → website ──────────────

async function pushToWebsite() {
  const unsynced = db.getUnsyncedCheckins();
  if (unsynced.length === 0) {
    console.log('  ↑ No unsynced check-ins to push.');
    return 0;
  }

  console.log(`  ↑ Pushing ${unsynced.length} check-in(s) to website...`);

  const url = `${config.websiteUrl}/api/gate/sync/checkins`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ checkins: unsynced }),
    timeout: 30000
  });

  if (!res.ok) {
    throw new Error(`Push failed: HTTP ${res.status} ${res.statusText}`);
  }

  const result = await res.json();
  if (result.success) {
    // Mark all as synced
    db.markCheckinsSynced(unsynced.map(c => c.id));
    console.log(`  ✓ Pushed ${result.imported} new, ${result.skipped} already existed`);
    return result.imported;
  }

  throw new Error(result.error || 'Push returned failure');
}

// ── Send heartbeat ──────────────────────────────────────

async function sendHeartbeat() {
  const stats = db.getStats();
  const uptime = Math.floor(process.uptime());

  try {
    await fetch(`${config.websiteUrl}/api/gate/heartbeat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        device_id: config.deviceId,
        uptime,
        last_sync: stats.lastSync,
        pending_checkins: stats.pendingSync,
        version: require('../package.json').version
      }),
      timeout: 10000
    });
  } catch (e) {
    // Heartbeat failure is non-critical
  }
}

// ── Full Sync Cycle ─────────────────────────────────────

async function runSync() {
  const startTime = Date.now();
  console.log(`\n── Sync cycle started at ${new Date().toLocaleString()} ──`);

  let pulled = 0;
  let pushed = 0;

  try {
    // Step 1: Pull latest data from website
    pulled = await pullFromWebsite();
    db.logSync('pull', pulled, 0, 'success');
  } catch (e) {
    console.error(`  ✗ Pull failed: ${e.message}`);
    db.logSync('pull', 0, 0, 'error', e.message);
    console.log('  → Will retry on next cycle. Local data remains valid.');
  }

  try {
    // Step 2: Push local check-ins to website
    pushed = await pushToWebsite();
    db.logSync('push', 0, pushed, 'success');
  } catch (e) {
    console.error(`  ✗ Push failed: ${e.message}`);
    db.logSync('push', 0, 0, 'error', e.message);
    console.log('  → Check-ins saved locally. Will retry on next cycle.');
  }

  // Step 3: Heartbeat
  await sendHeartbeat();

  const elapsed = Date.now() - startTime;
  console.log(`── Sync cycle completed in ${elapsed}ms ──\n`);

  return { pulled, pushed };
}

// ── Start Periodic Sync ─────────────────────────────────

let syncInterval = null;

function startPeriodicSync() {
  // Run initial sync immediately
  runSync().catch(e => console.error('Initial sync error:', e.message));

  // Then run on interval
  syncInterval = setInterval(() => {
    runSync().catch(e => console.error('Periodic sync error:', e.message));
  }, config.syncIntervalMs);

  console.log(`  ✓ Periodic sync enabled (every ${config.syncIntervalMs / 60000} minutes)`);
}

function stopPeriodicSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

module.exports = {
  pullFromWebsite,
  pushToWebsite,
  sendHeartbeat,
  runSync,
  startPeriodicSync,
  stopPeriodicSync
};
