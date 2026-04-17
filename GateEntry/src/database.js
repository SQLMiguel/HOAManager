// ─── Local Database Manager ─────────────────────────────
// Manages the local SQLite database on the Raspberry Pi.
// Same schema as the website pool tables, stored on external drive
// for fast (<2s) RFID lookups even when the website is offline.

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('./config');

let db;

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

  // Index for fast RFID lookups (the critical <2s path)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pool_members_rfid ON pool_members(rfid_tag)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pool_checkins_synced ON pool_checkins(synced)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pool_schedules_active ON pool_schedules(is_active)`);

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
  return lookupByRfidStmt().get(rfidTag);
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

function recordCheckin(poolMemberId, entryTypeId, status, isHoliday, notes) {
  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();
  db.prepare(`
    INSERT INTO pool_checkins (id, pool_member_id, entry_type_id, status, is_holiday, notes, synced)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(id, poolMemberId, entryTypeId, status, isHoliday ? 1 : 0, notes || null);
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

function replacePoolData(entryTypes, members, schedules) {
  const transaction = db.transaction(() => {
    // Clear and repopulate — full snapshot approach
    db.exec('DELETE FROM pool_entry_types');
    db.exec('DELETE FROM pool_members');
    db.exec('DELETE FROM pool_schedules');

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

function close() {
  if (db) db.close();
}

module.exports = {
  initDb,
  lookupByRfid,
  checkAccess,
  recordCheckin,
  getUnsyncedCheckins,
  markCheckinsSynced,
  replacePoolData,
  logSync,
  getLastSyncTime,
  getStats,
  close
};
