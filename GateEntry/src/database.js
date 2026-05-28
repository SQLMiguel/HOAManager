// ─── Local Database Manager ─────────────────────────────
// Manages the local SQLite database on the Raspberry Pi.
// Same schema as the website pool tables, stored on external drive
// for fast (<2s) RFID lookups even when the website is offline.

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');

let db;

// ── Credential hashing / TOTP helpers ──────────────────
// Phone-based credentials (NFC IDs, BLE tokens, QR tokens) are stored
// as SHA-256 hashes so a compromised DB does not leak raw secrets.
// RFID card UIDs are also hashed in the credentials table, but legacy
// pool_members.rfid_tag remains in place for backward compatibility.

function normalizeCredentialValue(type, rawValue) {
  if (rawValue == null) return '';
  const s = String(rawValue).trim();
  if (type === 'rfid' || type === 'nfc_phone') {
    return s.toUpperCase().replace(/[^0-9A-F]/g, '');
  }
  return s;
}

function hashCredential(type, rawValue) {
  const norm = normalizeCredentialValue(type, rawValue);
  return crypto.createHash('sha256').update(norm).digest('hex');
}

// RFC 6238 TOTP (30s window, 6 digits, SHA-1) using a base32 secret.
// Accepts ±1 time step drift. Used for rolling QR codes from companion apps.
function base32Decode(b32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(b32).toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = '';
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function totpGenerate(secretB32, counter) {
  const key = base32Decode(secretB32);
  const buf = Buffer.alloc(8);
  // counter is a 64-bit integer; JS numbers are fine up to 2^53
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

function totpVerify(secretB32, token, windowSteps = 1) {
  if (!secretB32 || !token) return false;
  const clean = String(token).replace(/\D/g, '');
  if (clean.length < 6) return false;
  const step = Math.floor(Date.now() / 1000 / 30);
  for (let w = -windowSteps; w <= windowSteps; w++) {
    try {
      if (totpGenerate(secretB32, step + w) === clean) return true;
    } catch (_) { /* ignore malformed secret */ }
  }
  return false;
}

function initDb() {
  // Ensure directory exists
  const dir = path.dirname(config.dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(config.dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  // Create tables matching the website schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS pool_entry_types (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      is_system INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS pool_members (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      entry_type_id TEXT NOT NULL,
      user_id TEXT,
      rfid_tag TEXT UNIQUE,
      source TEXT DEFAULT 'manual',
      status TEXT DEFAULT 'active' CHECK(status IN ('active','suspended','inactive')),
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS pool_schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      entry_type_id TEXT,
      pool_member_id TEXT,
      schedule_type TEXT NOT NULL CHECK(schedule_type IN ('recurring','one_time','unlimited','holiday')),
      days_of_week TEXT,
      start_time TEXT,
      end_time TEXT,
      specific_date TEXT,
      start_date TEXT,
      end_date TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Local check-in log — records all scans, synced to website hourly
  db.exec(`
    CREATE TABLE IF NOT EXISTS pool_checkins (
      id TEXT PRIMARY KEY,
      pool_member_id TEXT NOT NULL,
      entry_type_id TEXT NOT NULL,
      check_in_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      check_out_time DATETIME,
      status TEXT DEFAULT 'allowed' CHECK(status IN ('allowed','denied')),
      is_holiday INTEGER DEFAULT 0,
      notes TEXT,
      synced INTEGER DEFAULT 0
    )
  `);

  // Sync metadata — tracks last successful sync
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_type TEXT NOT NULL,
      sync_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      records_pulled INTEGER DEFAULT 0,
      records_pushed INTEGER DEFAULT 0,
      status TEXT DEFAULT 'success',
      error_message TEXT
    )
  `);

  // ── Phone / multi-credential support ──────────────────
  // A single pool member may have several credentials: a physical RFID
  // card, an iPhone NFC Wallet pass, an Android HCE tag, a BLE token,
  // or a QR code (static or rolling TOTP). The gate validates any of
  // them through the same access-check pipeline.
  db.exec(`
    CREATE TABLE IF NOT EXISTS pool_member_credentials (
      id TEXT PRIMARY KEY,
      pool_member_id TEXT NOT NULL,
      credential_type TEXT NOT NULL CHECK(credential_type IN ('rfid','nfc_phone','ble_token','qr_static','qr_totp')),
      credential_hash TEXT NOT NULL,
      totp_secret TEXT,
      device_platform TEXT CHECK(device_platform IN ('ios','android','card','other')),
      device_name TEXT,
      enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      revoked_at DATETIME,
      last_used_at DATETIME,
      status TEXT DEFAULT 'active' CHECK(status IN ('active','revoked','expired'))
    )
  `);

  // Extend pool_checkins with credential metadata (for audit / viewer).
  // Uses pragma check to avoid duplicate ALTER on re-init.
  const checkinCols = db.prepare("PRAGMA table_info(pool_checkins)").all().map(c => c.name);
  if (!checkinCols.includes('credential_type')) {
    db.exec(`ALTER TABLE pool_checkins ADD COLUMN credential_type TEXT`);
  }
  if (!checkinCols.includes('credential_id')) {
    db.exec(`ALTER TABLE pool_checkins ADD COLUMN credential_id TEXT`);
  }
  if (!checkinCols.includes('device_platform')) {
    db.exec(`ALTER TABLE pool_checkins ADD COLUMN device_platform TEXT`);
  }

  // Index for fast RFID lookups (the critical <2s path)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pool_members_rfid ON pool_members(rfid_tag)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pool_checkins_synced ON pool_checkins(synced)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pool_schedules_active ON pool_schedules(is_active)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_credentials_hash ON pool_member_credentials(credential_hash)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_credentials_type ON pool_member_credentials(credential_type, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_credentials_member ON pool_member_credentials(pool_member_id)`);

  console.log('  ✓ Local database initialized at', config.dbPath);
  return db;
}

// ── Fast RFID Lookup ────────────────────────────────────
// This is the hot path — must complete in <2 seconds

const lookupByRfidStmt = () => db.prepare(`
  SELECT pm.*, pet.name as entry_type_name
  FROM pool_members pm
  JOIN pool_entry_types pet ON pm.entry_type_id = pet.id
  WHERE pm.rfid_tag = ? AND pm.status = 'active'
`);

function lookupByRfid(rfidTag) {
  // Legacy path: pool_members.rfid_tag (still supported for existing cards)
  const legacy = lookupByRfidStmt().get(rfidTag);
  if (legacy) {
    return { ...legacy, credential_type: 'rfid', credential_id: null, device_platform: 'card' };
  }
  // New path: credentials table (also supports nfc_phone which looks identical on the reader)
  return lookupByHashedCredential('rfid', rfidTag) || lookupByHashedCredential('nfc_phone', rfidTag);
}

// ── Phone / multi-credential lookup ────────────────────

function lookupByHashedCredential(type, rawValue) {
  if (!db) return null;
  const hash = hashCredential(type, rawValue);
  const row = db.prepare(`
    SELECT pmc.id AS credential_id,
           pmc.credential_type,
           pmc.device_platform,
           pm.id, pm.first_name, pm.last_name, pm.entry_type_id,
           pm.user_id, pm.rfid_tag, pm.source, pm.status, pm.notes, pm.created_at,
           pet.name AS entry_type_name
    FROM pool_member_credentials pmc
    JOIN pool_members pm ON pmc.pool_member_id = pm.id
    JOIN pool_entry_types pet ON pm.entry_type_id = pet.id
    WHERE pmc.credential_hash = ?
      AND pmc.credential_type = ?
      AND pmc.status = 'active'
      AND pmc.revoked_at IS NULL
      AND pm.status = 'active'
  `).get(hash, type);
  return row || null;
}

function lookupByNfcPhone(nfcId) {
  return lookupByHashedCredential('nfc_phone', nfcId);
}

function lookupByBleToken(token) {
  return lookupByHashedCredential('ble_token', token);
}

function lookupByQrStatic(token) {
  return lookupByHashedCredential('qr_static', token);
}

function verifyQrTotp(token) {
  if (!db) return null;
  const rows = db.prepare(`
    SELECT pmc.id AS credential_id,
           pmc.credential_type,
           pmc.device_platform,
           pmc.totp_secret,
           pm.id, pm.first_name, pm.last_name, pm.entry_type_id,
           pm.user_id, pm.rfid_tag, pm.source, pm.status, pm.notes, pm.created_at,
           pet.name AS entry_type_name
    FROM pool_member_credentials pmc
    JOIN pool_members pm ON pmc.pool_member_id = pm.id
    JOIN pool_entry_types pet ON pm.entry_type_id = pet.id
    WHERE pmc.credential_type = 'qr_totp'
      AND pmc.status = 'active'
      AND pmc.revoked_at IS NULL
      AND pm.status = 'active'
  `).all();
  for (const row of rows) {
    if (totpVerify(row.totp_secret, token)) {
      const { totp_secret, ...rest } = row;
      return rest;
    }
  }
  return null;
}

// Dispatch table used by the unified scan handler.
function lookupByCredential(type, rawValue) {
  switch (type) {
    case 'rfid': return lookupByRfid(rawValue);
    case 'nfc_phone': return lookupByNfcPhone(rawValue);
    case 'ble_token': return lookupByBleToken(rawValue);
    case 'qr_static': return lookupByQrStatic(rawValue);
    case 'qr_totp': return verifyQrTotp(rawValue);
    default: return null;
  }
}

function touchCredentialUsed(credentialId) {
  if (!credentialId) return;
  try {
    db.prepare('UPDATE pool_member_credentials SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(credentialId);
  } catch (_) { /* non-fatal */ }
}

// ── Schedule-Based Access Check ─────────────────────────
// Same logic as the website's access-check endpoint

function checkAccess(member) {
  const now = new Date();
  const checkDate = now.toISOString().split('T')[0];
  const checkTime = now.toTimeString().slice(0, 5);
  const dayOfWeek = now.getDay();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayName = dayNames[dayOfWeek];

  const schedules = db.prepare(`
    SELECT * FROM pool_schedules
    WHERE is_active = 1
      AND (entry_type_id = ? OR pool_member_id = ?)
      AND (start_date IS NULL OR start_date <= ?)
      AND (end_date IS NULL OR end_date >= ?)
  `).all(member.entry_type_id, member.id, checkDate, checkDate);

  // Holiday schedules override everything
  const holidaySchedules = schedules.filter(s => s.schedule_type === 'holiday' && s.specific_date === checkDate);
  if (holidaySchedules.length > 0) {
    for (const h of holidaySchedules) {
      if (checkTime >= h.start_time && checkTime <= h.end_time) {
        return { allowed: true, reason: h.name + ' (holiday)', isHoliday: true };
      }
    }
    return { allowed: false, reason: 'Outside holiday hours', isHoliday: true };
  }

  for (const s of schedules) {
    if (s.schedule_type === 'unlimited') {
      return { allowed: true, reason: s.name, isHoliday: false };
    }
    if (s.schedule_type === 'recurring' && s.days_of_week) {
      const days = s.days_of_week.split(',');
      if (days.includes(dayName) && checkTime >= s.start_time && checkTime <= s.end_time) {
        return { allowed: true, reason: s.name, isHoliday: false };
      }
    }
    if (s.schedule_type === 'one_time' && s.specific_date === checkDate) {
      if (checkTime >= s.start_time && checkTime <= s.end_time) {
        return { allowed: true, reason: s.name, isHoliday: false };
      }
    }
  }

  return { allowed: false, reason: 'No schedule', isHoliday: false };
}

// ── Check-in Recording ─────────────────────────────────

function recordCheckin(poolMemberId, entryTypeId, status, isHoliday, notes, credentialInfo) {
  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();
  const credType = credentialInfo?.credential_type || 'rfid';
  const credId = credentialInfo?.credential_id || null;
  const platform = credentialInfo?.device_platform || 'card';
  db.prepare(`
    INSERT INTO pool_checkins (id, pool_member_id, entry_type_id, status, is_holiday, notes, synced,
      credential_type, credential_id, device_platform)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `).run(id, poolMemberId, entryTypeId, status, isHoliday ? 1 : 0, notes || null,
         credType, credId, platform);
  if (credId) touchCredentialUsed(credId);
  return id;
}

// ── Unsynced Check-ins ──────────────────────────────────

function getUnsyncedCheckins() {
  return db.prepare('SELECT * FROM pool_checkins WHERE synced = 0').all();
}

function markCheckinsSynced(ids) {
  const stmt = db.prepare('UPDATE pool_checkins SET synced = 1 WHERE id = ?');
  const transaction = db.transaction((idList) => {
    for (const id of idList) {
      stmt.run(id);
    }
  });
  transaction(ids);
}

// ── Full Data Replace (from website pull) ───────────────

function replacePoolData(entryTypes, members, schedules, credentials) {
  const transaction = db.transaction(() => {
    // Clear and repopulate — full snapshot approach
    db.exec('DELETE FROM pool_entry_types');
    db.exec('DELETE FROM pool_members');
    db.exec('DELETE FROM pool_schedules');
    db.exec('DELETE FROM pool_member_credentials');

    const insertType = db.prepare(
      'INSERT INTO pool_entry_types (id, name, description, is_system, created_at) VALUES (?, ?, ?, ?, ?)'
    );
    for (const t of entryTypes) {
      insertType.run(t.id, t.name, t.description, t.is_system, t.created_at);
    }

    const insertMember = db.prepare(
      'INSERT INTO pool_members (id, first_name, last_name, entry_type_id, user_id, rfid_tag, source, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const m of members) {
      insertMember.run(m.id, m.first_name, m.last_name, m.entry_type_id, m.user_id, m.rfid_tag, m.source, m.status, m.notes, m.created_at);
    }

    const insertSchedule = db.prepare(
      'INSERT INTO pool_schedules (id, name, entry_type_id, pool_member_id, schedule_type, days_of_week, start_time, end_time, specific_date, start_date, end_date, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const s of schedules) {
      insertSchedule.run(s.id, s.name, s.entry_type_id, s.pool_member_id, s.schedule_type, s.days_of_week, s.start_time, s.end_time, s.specific_date, s.start_date, s.end_date, s.is_active, s.created_at);
    }

    // Phone credentials are optional in the sync payload for backward compatibility.
    const insertCredential = db.prepare(
      `INSERT INTO pool_member_credentials
       (id, pool_member_id, credential_type, credential_hash, totp_secret,
        device_platform, device_name, enrolled_at, revoked_at, last_used_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of (credentials || [])) {
      // Accept either a pre-hashed credential from the server, or hash a raw value here.
      const hash = c.credential_hash
        || (c.credential_value ? hashCredential(c.credential_type, c.credential_value) : null);
      if (!hash) continue;
      insertCredential.run(
        c.id,
        c.pool_member_id,
        c.credential_type,
        hash,
        c.totp_secret || null,
        c.device_platform || null,
        c.device_name || null,
        c.enrolled_at || null,
        c.revoked_at || null,
        c.last_used_at || null,
        c.status || 'active'
      );
    }
  });

  transaction();
}

// ── Sync Log ────────────────────────────────────────────

function logSync(type, pulled, pushed, status, errorMsg) {
  db.prepare(
    'INSERT INTO sync_log (sync_type, records_pulled, records_pushed, status, error_message) VALUES (?, ?, ?, ?, ?)'
  ).run(type, pulled, pushed, status, errorMsg || null);
}

function getLastSyncTime() {
  const row = db.prepare(
    "SELECT sync_time FROM sync_log WHERE status = 'success' AND sync_type = 'pull' ORDER BY sync_time DESC LIMIT 1"
  ).get();
  return row ? row.sync_time : null;
}

function getStats() {
  const totalMembers = db.prepare('SELECT COUNT(*) as c FROM pool_members WHERE status = ?').get('active');
  const rfidMembers = db.prepare('SELECT COUNT(*) as c FROM pool_members WHERE rfid_tag IS NOT NULL AND status = ?').get('active');
  const unsyncedCheckins = db.prepare('SELECT COUNT(*) as c FROM pool_checkins WHERE synced = 0').get();
  const lastSync = getLastSyncTime();
  return {
    activeMembers: totalMembers?.c || 0,
    rfidAssigned: rfidMembers?.c || 0,
    pendingSync: unsyncedCheckins?.c || 0,
    lastSync
  };
}

// ── Read-only Viewer Queries ───────────────────────────

function getViewerSummary() {
  const activeMembers = db.prepare("SELECT COUNT(*) as c FROM pool_members WHERE status = 'active'").get()?.c || 0;
  const suspendedMembers = db.prepare("SELECT COUNT(*) as c FROM pool_members WHERE status = 'suspended'").get()?.c || 0;
  const inactiveMembers = db.prepare("SELECT COUNT(*) as c FROM pool_members WHERE status = 'inactive'").get()?.c || 0;
  const rfidAssigned = db.prepare("SELECT COUNT(*) as c FROM pool_members WHERE rfid_tag IS NOT NULL").get()?.c || 0;
  const schedules = db.prepare('SELECT COUNT(*) as c FROM pool_schedules WHERE is_active = 1').get()?.c || 0;
  const pendingSync = db.prepare('SELECT COUNT(*) as c FROM pool_checkins WHERE synced = 0').get()?.c || 0;
  const totalCheckins = db.prepare('SELECT COUNT(*) as c FROM pool_checkins').get()?.c || 0;
  const lastSync = getLastSyncTime();

  // Phone credential counts
  const phoneCreds = db.prepare(`
    SELECT credential_type, device_platform, COUNT(*) AS c
    FROM pool_member_credentials
    WHERE status = 'active'
    GROUP BY credential_type, device_platform
  `).all();
  const credentialSummary = {
    total: 0, ios: 0, android: 0, card: 0, other: 0,
    byType: { rfid: 0, nfc_phone: 0, ble_token: 0, qr_static: 0, qr_totp: 0 }
  };
  for (const r of phoneCreds) {
    credentialSummary.total += r.c;
    if (r.device_platform && credentialSummary[r.device_platform] != null) {
      credentialSummary[r.device_platform] += r.c;
    }
    if (credentialSummary.byType[r.credential_type] != null) {
      credentialSummary.byType[r.credential_type] += r.c;
    }
  }

  return {
    activeMembers,
    suspendedMembers,
    inactiveMembers,
    rfidAssigned,
    activeSchedules: schedules,
    pendingSync,
    totalCheckins,
    lastSync,
    credentials: credentialSummary
  };
}

function getMembersForViewer(options = {}) {
  const status = (options.status || 'all').toLowerCase();
  const q = (options.q || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(parseInt(options.limit || 500), 2000));

  let sql = `
    SELECT pm.id, pm.first_name, pm.last_name, pm.rfid_tag, pm.source, pm.status,
           pm.notes, pm.created_at, pet.name AS entry_type_name
    FROM pool_members pm
    JOIN pool_entry_types pet ON pm.entry_type_id = pet.id
    WHERE 1=1
  `;
  const params = [];

  if (status !== 'all') {
    sql += ' AND pm.status = ?';
    params.push(status);
  }

  if (q) {
    sql += ' AND (LOWER(pm.first_name) LIKE ? OR LOWER(pm.last_name) LIKE ? OR LOWER(pm.rfid_tag) LIKE ? OR LOWER(pet.name) LIKE ?)';
    const pattern = `%${q}%`;
    params.push(pattern, pattern, pattern, pattern);
  }

  sql += ' ORDER BY pm.last_name ASC, pm.first_name ASC LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params);
}

function getSchedulesForViewer(limit = 1000) {
  const capped = Math.max(1, Math.min(parseInt(limit || 1000), 5000));
  return db.prepare(`
    SELECT ps.id, ps.name, ps.schedule_type, ps.days_of_week, ps.start_time, ps.end_time,
           ps.specific_date, ps.start_date, ps.end_date, ps.is_active, ps.created_at,
           pet.name AS entry_type_name,
           pm.first_name AS member_first_name,
           pm.last_name AS member_last_name
    FROM pool_schedules ps
    LEFT JOIN pool_entry_types pet ON ps.entry_type_id = pet.id
    LEFT JOIN pool_members pm ON ps.pool_member_id = pm.id
    ORDER BY ps.created_at DESC
    LIMIT ?
  `).all(capped);
}

function getRecentCheckinsForViewer(limit = 300) {
  const capped = Math.max(1, Math.min(parseInt(limit || 300), 2000));
  return db.prepare(`
    SELECT pc.id, pc.check_in_time, pc.status, pc.is_holiday, pc.notes, pc.synced,
           pc.credential_type, pc.device_platform,
           pm.first_name, pm.last_name,
           pet.name AS entry_type_name
    FROM pool_checkins pc
    LEFT JOIN pool_members pm ON pc.pool_member_id = pm.id
    LEFT JOIN pool_entry_types pet ON pc.entry_type_id = pet.id
    ORDER BY pc.check_in_time DESC
    LIMIT ?
  `).all(capped);
}

function getCredentialsForViewer(options = {}) {
  const type = (options.type || 'all').toLowerCase();
  const platform = (options.platform || 'all').toLowerCase();
  const limit = Math.max(1, Math.min(parseInt(options.limit || 500), 2000));

  let sql = `
    SELECT pmc.id, pmc.credential_type, pmc.device_platform, pmc.device_name,
           pmc.status, pmc.enrolled_at, pmc.revoked_at, pmc.last_used_at,
           pm.first_name, pm.last_name,
           pet.name AS entry_type_name
    FROM pool_member_credentials pmc
    JOIN pool_members pm ON pmc.pool_member_id = pm.id
    JOIN pool_entry_types pet ON pm.entry_type_id = pet.id
    WHERE 1=1
  `;
  const params = [];
  if (type !== 'all') { sql += ' AND pmc.credential_type = ?'; params.push(type); }
  if (platform !== 'all') { sql += ' AND pmc.device_platform = ?'; params.push(platform); }
  sql += ' ORDER BY pm.last_name ASC, pm.first_name ASC, pmc.enrolled_at DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params);
}

function getSyncLogForViewer(limit = 200) {
  const capped = Math.max(1, Math.min(parseInt(limit || 200), 2000));
  return db.prepare(`
    SELECT id, sync_type, sync_time, records_pulled, records_pushed, status, error_message
    FROM sync_log
    ORDER BY sync_time DESC
    LIMIT ?
  `).all(capped);
}

function getViewerSnapshot() {
  return {
    summary: getViewerSummary(),
    members: getMembersForViewer({ limit: 500 }),
    credentials: getCredentialsForViewer({ limit: 500 }),
    schedules: getSchedulesForViewer(200),
    checkins: getRecentCheckinsForViewer(100),
    syncLog: getSyncLogForViewer(25)
  };
}

function close() {
  if (db) db.close();
}

module.exports = {
  initDb,
  lookupByRfid,
  lookupByCredential,
  lookupByNfcPhone,
  lookupByBleToken,
  lookupByQrStatic,
  verifyQrTotp,
  hashCredential,
  totpGenerate,
  totpVerify,
  checkAccess,
  recordCheckin,
  getUnsyncedCheckins,
  markCheckinsSynced,
  replacePoolData,
  logSync,
  getLastSyncTime,
  getStats,
  getViewerSummary,
  getMembersForViewer,
  getSchedulesForViewer,
  getRecentCheckinsForViewer,
  getSyncLogForViewer,
  getCredentialsForViewer,
  getViewerSnapshot,
  close
};
