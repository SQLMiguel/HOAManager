/* ===================================
   Glenridge Community HOA — Server
   Express + MySQL + Nodemailer
   =================================== */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const MySQLStore = require('express-mysql-session')(session);
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;

const JSZip = require('jszip');

// Build a minimal valid PNG buffer (solid color, no external libs)
function makeSolidPng(width, height, r, g, b) {
  const zlib = require('zlib');
  // CRC32 table
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crcBuf]);
  }
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0); ihdrData.writeUInt32BE(height, 4);
  ihdrData[8]=8; ihdrData[9]=2; // 8-bit RGB
  const rowLen = 1 + width*3;
  const raw = Buffer.alloc(height * rowLen);
  for (let y=0; y<height; y++) {
    raw[y*rowLen] = 0;
    for (let x=0; x<width; x++) {
      raw[y*rowLen+1+x*3]=r; raw[y*rowLen+2+x*3]=g; raw[y*rowLen+3+x*3]=b;
    }
  }
  const compressed = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR',ihdrData), chunk('IDAT',compressed), chunk('IEND',Buffer.alloc(0))]);
}

let twilioLib = null;
try {
  twilioLib = require('twilio');
} catch (_) {
  twilioLib = null;
}

const app = express();
const PORT = process.env.PORT || 3000;
const SALT_ROUNDS = 12;

// ── Branding / contact (configurable via env) ─────────────
const BRAND_NAME      = process.env.BRAND_NAME      || 'Glenridge Community HOA';
const BRAND_SHORT     = process.env.BRAND_SHORT     || 'Glenridge Community';
const BRAND_LOCATION  = process.env.BRAND_LOCATION  || 'Winston-Salem, NC';
const ADMIN_EMAIL     = process.env.ADMIN_EMAIL     || 'admin@glenridgecommunity.com';
const MAIL_FROM_EMAIL = process.env.MAIL_FROM_EMAIL || process.env.SMTP_USER || ADMIN_EMAIL;
const SITE_URL        = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

// ── Pool location (for mobile-app geofence verification) ─
const POOL_LATITUDE  = parseFloat(process.env.POOL_LATITUDE  || '0') || null;
const POOL_LONGITUDE = parseFloat(process.env.POOL_LONGITUDE || '0') || null;
const POOL_GEOFENCE_METERS = parseInt(process.env.POOL_GEOFENCE_METERS || '250', 10);

// ── Validation helpers ────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function isValidEmail(v) { return EMAIL_RE.test((v || '').trim()); }
function isValidPhone(v) { const d = (v || '').replace(/\D/g, ''); return d.length === 0 || d.length === 10; }
function normalizeUSPhone(v) {
  const d = (v || '').replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}
function maskPhone(v) {
  const d = (v || '').replace(/\D/g, '');
  if (d.length < 4) return '';
  return `***-***-${d.slice(-4)}`;
}

// ── Database Setup ──────────────────────────────────────
const dbConfig = {
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '3306'),
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'glenridge',
};

console.log('═══ Database connection config ═══');
console.log(`  DB_HOST:     ${dbConfig.host}`);
console.log(`  DB_PORT:     ${dbConfig.port}`);
console.log(`  DB_USER:     ${dbConfig.user}`);
console.log(`  DB_NAME:     ${dbConfig.database}`);
console.log(`  DB_PASSWORD: ${dbConfig.password ? '(' + dbConfig.password.length + ' chars)' : '(empty!)'}`);
console.log('═══════════════════════════════════');

const dbPool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
});

async function initDb() {
  // Test the connection up-front so failures produce a clear error
  let conn;
  try {
    conn = await dbPool.getConnection();
    console.log('✓ MySQL connection established');
  } catch (err) {
    console.error('✗ Could not connect to MySQL.');
    console.error(`  Error: ${err.code || err.message}`);
    if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('  → Wrong DB_USER or DB_PASSWORD.');
    } else if (err.code === 'ER_BAD_DB_ERROR') {
      console.error(`  → Database "${dbConfig.database}" does not exist. Create it in hPanel first.`);
    } else if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      console.error(`  → Host "${dbConfig.host}" not reachable. Check DB_HOST.`);
    }
    throw err;
  }
  try {

  // Create users table (password_hash nullable to support OAuth users)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      address TEXT NOT NULL,
      phone TEXT,
      sms_opt_out INTEGER DEFAULT 0,
      sms_unsubscribe_token VARCHAR(36) UNIQUE,
      password_hash TEXT,
      oauth_provider TEXT,
      oauth_provider_id TEXT,
      status VARCHAR(10) DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      approved_at DATETIME,
      approved_by VARCHAR(100)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  // Migrate: add missing columns (safe — MySQL ignores duplicate column errors)
  const alterUsers = [
    `ALTER TABLE users ADD COLUMN oauth_provider VARCHAR(50)`,
    `ALTER TABLE users ADD COLUMN oauth_provider_id VARCHAR(255)`,
    `ALTER TABLE users ADD COLUMN sms_opt_out TINYINT(1) DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN sms_unsubscribe_token VARCHAR(36) UNIQUE`,
  ];
  for (const sql of alterUsers) {
    try { await conn.query(sql); } catch(e) { /* column already exists */ }
  }

  // Ensure all users have an SMS unsubscribe token
  const [usersMissingSmsToken] = await conn.query(`SELECT id FROM users WHERE sms_unsubscribe_token IS NULL OR TRIM(sms_unsubscribe_token) = ''`);
  for (const u of usersMissingSmsToken) {
    await conn.query(`UPDATE users SET sms_unsubscribe_token = ? WHERE id = ?`, [uuidv4(), u.id]);
  }

  // ── Directory tables ───────────────────────────────
  await conn.query(`
    CREATE TABLE IF NOT EXISTS dir_profiles (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) UNIQUE NOT NULL,
      display_name TEXT,
      phone TEXT,
      show_phone INTEGER DEFAULT 0,
      show_email INTEGER DEFAULT 0,
      anniversary TEXT,
      show_anniversary INTEGER DEFAULT 0,
      interests TEXT,
      show_interests INTEGER DEFAULT 0,
      notes TEXT,
      show_notes INTEGER DEFAULT 0,
      do_not_list INTEGER DEFAULT 0,
      is_published TINYINT(1) DEFAULT 0,
      consent_given TINYINT(1) DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await conn.query(`
    CREATE TABLE IF NOT EXISTS dir_adults (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      name TEXT NOT NULL,
      birthday TEXT,
      show_birthday TINYINT(1) DEFAULT 0,
      phone VARCHAR(30),
      email VARCHAR(255),
      is_visible TINYINT(1) DEFAULT 1
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await conn.query(`
    CREATE TABLE IF NOT EXISTS dir_children (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      first_name TEXT NOT NULL,
      birth_month INTEGER,
      birth_day INTEGER,
      show_birthday TINYINT(1) DEFAULT 0,
      is_visible TINYINT(1) DEFAULT 1,
      is_16_plus TINYINT(1) DEFAULT 0,
      phone VARCHAR(30),
      email VARCHAR(255)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await conn.query(`
    CREATE TABLE IF NOT EXISTS dir_pets (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      name TEXT NOT NULL,
      pet_type TEXT,
      is_visible TINYINT(1) DEFAULT 1
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await conn.query(`
    CREATE TABLE IF NOT EXISTS dir_social (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      platform TEXT NOT NULL,
      url TEXT NOT NULL,
      is_visible TINYINT(1) DEFAULT 1
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await conn.query(`
    CREATE TABLE IF NOT EXISTS dir_photos (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      filename TEXT NOT NULL,
      category TEXT DEFAULT 'Household',
      caption TEXT,
      is_visible TINYINT(1) DEFAULT 1,
      display_order INT DEFAULT 0,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await conn.query(`
    CREATE TABLE IF NOT EXISTS dir_audit (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      ts DATETIME DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  // Community events table
  await conn.query(`
    CREATE TABLE IF NOT EXISTS community_events (
      id VARCHAR(36) PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      event_date TEXT NOT NULL,
      event_time TEXT,
      location TEXT,
      created_by_id TEXT NOT NULL,
      created_by_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  // ── Newsletter tables ───────────────────────────────
  await conn.query(`
    CREATE TABLE IF NOT EXISTS nl_newsletters (
      id VARCHAR(36) PRIMARY KEY,
      subject TEXT NOT NULL,
      preview_text TEXT,
      html_content TEXT,
      blocks_json TEXT,
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft','scheduled','sent')),
      scheduled_at DATETIME,
      sent_at DATETIME,
      recipient_count INTEGER DEFAULT 0,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await conn.query(`
    CREATE TABLE IF NOT EXISTS nl_subscribers (
      id VARCHAR(36) PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      first_name TEXT,
      last_name TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('active','unsubscribed','bounced')),
      subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      unsubscribed_at DATETIME,
      unsubscribe_token VARCHAR(100) UNIQUE,
      bounce_count INT DEFAULT 0,
      source VARCHAR(50) DEFAULT 'member'
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await conn.query(`
    CREATE TABLE IF NOT EXISTS nl_send_log (
      id VARCHAR(36) PRIMARY KEY,
      newsletter_id VARCHAR(36) NOT NULL,
      subscriber_id VARCHAR(36) NOT NULL,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      delivery_status VARCHAR(20) DEFAULT 'sent'
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await conn.query(`
    CREATE TABLE IF NOT EXISTS nl_engagement (
      id VARCHAR(36) PRIMARY KEY,
      send_log_id VARCHAR(36) NOT NULL,
      event_type TEXT NOT NULL,
      url TEXT,
      occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  // SMS broadcast history
  await conn.query(`
    CREATE TABLE IF NOT EXISTS sms_broadcasts (
      id VARCHAR(36) PRIMARY KEY,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      sent_by TEXT,
      message TEXT NOT NULL,
      recipients_total INTEGER DEFAULT 0,
      sent_count INTEGER DEFAULT 0,
      failed_count INT DEFAULT 0,
      note TEXT
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  // Password reset tokens table
  await conn.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      token_hash VARCHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      used TINYINT(1) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  // ── Pool Management tables ─────────────────────────────
  await conn.query(`
    CREATE TABLE IF NOT EXISTS pool_entry_types (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(100) UNIQUE NOT NULL,
      description TEXT,
      is_system TINYINT(1) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS pool_members (
      id VARCHAR(36) PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      entry_type_id VARCHAR(36) NOT NULL,
      user_id VARCHAR(100),
      rfid_tag VARCHAR(100) UNIQUE,
      source VARCHAR(20) DEFAULT 'manual',
      status VARCHAR(20) DEFAULT 'active',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS pool_schedules (
      id VARCHAR(36) PRIMARY KEY,
      name TEXT NOT NULL,
      entry_type_id VARCHAR(36),
      pool_member_id VARCHAR(36),
      schedule_type VARCHAR(20) NOT NULL,
      days_of_week TEXT,
      start_time TEXT,
      end_time TEXT,
      specific_date TEXT,
      start_date TEXT,
      end_date TEXT,
      is_active TINYINT(1) DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  // Pool check-in log (attendance tracking)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS pool_checkins (
      id VARCHAR(36) PRIMARY KEY,
      pool_member_id VARCHAR(36) NOT NULL,
      entry_type_id VARCHAR(36) NOT NULL,
      check_in_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      check_out_time DATETIME,
      status VARCHAR(20) DEFAULT 'allowed',
      is_holiday TINYINT(1) DEFAULT 0,
      notes TEXT
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  // Migrations: add any missing columns (safe on MySQL — ignored if column exists)
  const alterAdults = [
    `ALTER TABLE dir_adults ADD COLUMN phone VARCHAR(30)`,
    `ALTER TABLE dir_adults ADD COLUMN email VARCHAR(255)`,
    `ALTER TABLE dir_adults ADD COLUMN sms_opt_in TINYINT(1) DEFAULT 0`,
  ];
  const alterChildren = [
    `ALTER TABLE dir_children ADD COLUMN is_16_plus TINYINT(1) DEFAULT 0`,
    `ALTER TABLE dir_children ADD COLUMN phone VARCHAR(30)`,
    `ALTER TABLE dir_children ADD COLUMN email VARCHAR(255)`,
    `ALTER TABLE dir_children ADD COLUMN sms_opt_in TINYINT(1) DEFAULT 0`,
  ];
  const alterPoolMembers = [
    `ALTER TABLE pool_members ADD COLUMN rfid_tag VARCHAR(100) UNIQUE`,
  ];
  const alterPoolCheckins = [
    `ALTER TABLE pool_checkins ADD COLUMN person_name VARCHAR(120)`,
    `ALTER TABLE pool_checkins ADD COLUMN reason VARCHAR(80)`,
    `ALTER TABLE pool_checkins ADD COLUMN source VARCHAR(40) DEFAULT 'rfid'`,
  ];
  for (const sql of [...alterAdults, ...alterChildren, ...alterPoolMembers, ...alterPoolCheckins]) {
    try { await conn.query(sql); } catch(e) { /* column already exists */ }
  }

  // ── Pool phone-access credentials (per household person) ─────────
  await conn.query(`
    CREATE TABLE IF NOT EXISTS dir_pool_phones (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      person_type VARCHAR(10) NOT NULL,
      person_id VARCHAR(36),
      person_name TEXT NOT NULL,
      device_platform VARCHAR(10) NOT NULL,
      device_label VARCHAR(100),
      credential_token_hash VARCHAR(64),
      pool_member_id VARCHAR(36),
      wallet_pass_status VARCHAR(10) DEFAULT 'pending',
      status VARCHAR(10) DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      revoked_at DATETIME
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  try { await conn.query(`ALTER TABLE dir_pool_phones ADD COLUMN wallet_pass_status VARCHAR(10) DEFAULT 'pending'`); } catch(e) {}

  // Cleanup: remove orphaned Resident pool_members rows whose owning directory
  // adult/child no longer exists, or whose owning user isn't approved. All
  // Residents must map to an approved household address.
  try {
    await cleanupOrphanedResidentPoolMembers();
  } catch (e) {
    console.warn('  ⚠ Orphaned resident cleanup skipped:', e && e.message ? e.message : e);
  }

  // Pool NFC credentials (Apple Wallet passes for iPhones)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS pool_nfc_credentials (
      id VARCHAR(36) PRIMARY KEY,
      pool_member_id VARCHAR(36) NOT NULL,
      credential_hash VARCHAR(64) NOT NULL UNIQUE,
      credential_type VARCHAR(20) DEFAULT 'nfc_phone',
      device_platform VARCHAR(10),
      device_name VARCHAR(100),
      pass_serial VARCHAR(100) UNIQUE,
      pass_generated_at DATETIME,
      status VARCHAR(10) DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      revoked_at DATETIME
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  // Seed default entry types if empty
  const [[typeCount]] = await conn.query('SELECT COUNT(*) as c FROM pool_entry_types');
  if (typeCount.c === 0) {
    const defaults = [
      { name: 'Resident', desc: 'HOA members and their family members', system: 1 },
      { name: 'Lifeguard', desc: 'Pool lifeguards', system: 1 },
      { name: 'Vendor', desc: 'Service vendors and contractors', system: 1 },
      { name: 'Admin', desc: 'HOA administrators', system: 1 }
    ];
    for (const d of defaults) {
      await conn.query('INSERT INTO pool_entry_types (id, name, description, is_system) VALUES (?, ?, ?, ?)',
        [uuidv4(), d.name, d.desc, d.system]);
    }
  }

  } finally {
    conn.release();
  }
}

// ── MySQL query helpers ─────────────────────────────────
async function dbAll(sql, params = []) {
  const [rows] = await dbPool.query(sql, params);
  return rows;
}

async function dbGet(sql, params = []) {
  const rows = await dbAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

async function dbRun(sql, params = []) {
  await dbPool.query(sql, params);
}

async function poolMembersHasRfidTagColumn() {
  try {
    const [rows] = await dbPool.query(`SHOW COLUMNS FROM pool_members LIKE 'rfid_tag'`);
    return rows.length > 0;
  } catch (e) {
    return false;
  }
}

function normalizeStreetAddress(address) {
  if (!address) return null;
  let street = String(address).split(',')[0].trim();
  // Remove unit/apartment/suite details so we keep only number + street name
  street = street.replace(/\s+(apt|apartment|unit|suite|ste|#)\s*[\w-]+.*$/i, '');
  street = street.replace(/\s+/g, ' ').trim();
  return street || null;
}

async function getPoolMemberStreetAddress(poolMember) {
  const h = await getPoolMemberHousehold(poolMember);
  return h ? h.streetAddress : null;
}

// Resolve the owning household for a pool_members row.
// Returns { ownerUserId, streetAddress, ownerFirstName, ownerLastName } or null
// for manual/guest rows that are not tied to a resident household.
async function getPoolMemberHousehold(poolMember) {
  if (!poolMember) return null;

  // Standard approved resident row: pool_members.user_id points at users.id
  if (poolMember.source === 'member' && poolMember.user_id) {
    const user = await dbGet('SELECT id, first_name, last_name, address FROM users WHERE id = ?', [poolMember.user_id]);
    if (!user) return null;
    return {
      ownerUserId: user.id,
      streetAddress: normalizeStreetAddress(user.address),
      ownerFirstName: user.first_name || '',
      ownerLastName: user.last_name || ''
    };
  }

  // Family adult rows use pseudo user_id: family_adult_<dir_adults.id>
  if (poolMember.source === 'family' && poolMember.user_id && poolMember.user_id.startsWith('family_adult_')) {
    const adultId = poolMember.user_id.replace('family_adult_', '');
    const row = await dbGet(`
      SELECT u.id, u.first_name, u.last_name, u.address
      FROM dir_adults da
      JOIN users u ON u.id = da.user_id
      WHERE da.id = ?
      LIMIT 1
    `, [adultId]);
    if (!row) return null;
    return {
      ownerUserId: row.id,
      streetAddress: normalizeStreetAddress(row.address),
      ownerFirstName: row.first_name || '',
      ownerLastName: row.last_name || ''
    };
  }

  // Family child rows use pseudo user_id: family_child_<dir_children.id>
  if (poolMember.source === 'family' && poolMember.user_id && poolMember.user_id.startsWith('family_child_')) {
    const childId = poolMember.user_id.replace('family_child_', '');
    const row = await dbGet(`
      SELECT u.id, u.first_name, u.last_name, u.address
      FROM dir_children dc
      JOIN users u ON u.id = dc.user_id
      WHERE dc.id = ?
      LIMIT 1
    `, [childId]);
    if (!row) return null;
    return {
      ownerUserId: row.id,
      streetAddress: normalizeStreetAddress(row.address),
      ownerFirstName: row.first_name || '',
      ownerLastName: row.last_name || ''
    };
  }

  return null;
}

// Remove pool_members rows with Entry Type = 'Resident' that cannot be
// associated to a household address. This happens when the owning directory
// adult/child was deleted, or when the owning user was removed/denied.
// Guests, lifeguards, vendors, admins, etc. are left alone — they legitimately
// have no household address.
async function cleanupOrphanedResidentPoolMembers() {
  const residentType = await dbGet(`SELECT id FROM pool_entry_types WHERE name = 'Resident'`);
  if (!residentType) return 0;

  const residents = await dbAll(
    `SELECT * FROM pool_members WHERE entry_type_id = ?`,
    [residentType.id]);

  let removed = 0;
  for (const pm of residents) {
    const household = await getPoolMemberHousehold(pm);
    if (household && household.ownerUserId) continue; // has an owner → keep

    // Orphaned resident — revoke credentials, remove the row.
    await dbRun(
      `UPDATE pool_nfc_credentials
         SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP
       WHERE pool_member_id = ? AND status = 'active'`,
      [pm.id]);
    await dbRun(`DELETE FROM pool_members WHERE id = ?`, [pm.id]);
    removed++;
  }

  if (removed > 0) {

    console.log(`  ✓ Removed ${removed} orphaned Resident pool_member(s) with no household`);
  }
  return removed;
}

// Remove dependent rows (pool membership, wallet-pass registrations, newsletter
// subscription) when a directory adult/child is deleted from a household.
// SMS eligibility is automatically recomputed because it joins against
// dir_adults / dir_children at query time, so deleting the row is enough.
async function cleanupFamilyMemberDeletion({ personType, personId, email, ownerUserId }) {
  try {
    const pseudoUserId = personType === 'adult'
      ? `family_adult_${personId}`
      : `family_child_${personId}`;

    // 1) Revoke any wallet-pass phone registrations for this person
    await dbRun(
      `UPDATE dir_pool_phones
         SET status = 'revoked',
             revoked_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
       WHERE person_type = ? AND person_id = ? AND status = 'active'`,
      [personType, personId]);

    // 2) Revoke pool NFC credentials tied to the pool_members rows for this person,
    //    then delete the pool_members rows so they disappear from Pool Management.
    const poolRows = await dbAll(
      `SELECT id FROM pool_members WHERE user_id = ? AND source = 'family'`,
      [pseudoUserId]);
    for (const pm of poolRows) {
      await dbRun(
        `UPDATE pool_nfc_credentials
           SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP
         WHERE pool_member_id = ? AND status = 'active'`,
        [pm.id]);
      await dbRun(`DELETE FROM pool_members WHERE id = ?`, [pm.id]);
    }

    // 3) Newsletter: unsubscribe matching email, but only if no approved user
    //    and no other directory adult/child in this household still uses it.
    if (email) {
      const trimmed = email.trim().toLowerCase();
      if (trimmed) {
        const userUsing = await dbGet(
          `SELECT id FROM users WHERE LOWER(email) = ? AND status = 'approved' LIMIT 1`,
          [trimmed]);
        const adultUsing = await dbGet(
          `SELECT id FROM dir_adults
            WHERE LOWER(email) = ?
              AND NOT (user_id = ? AND id = ?)
            LIMIT 1`,
          [trimmed, ownerUserId, personType === 'adult' ? personId : '']);
        const childUsing = await dbGet(
          `SELECT id FROM dir_children
            WHERE LOWER(email) = ?
              AND NOT (user_id = ? AND id = ?)
            LIMIT 1`,
          [trimmed, ownerUserId, personType === 'child' ? personId : '']);
        if (!userUsing && !adultUsing && !childUsing) {
          await dbRun(
            `UPDATE nl_subscribers
                SET status = 'unsubscribed',
                    unsubscribed_at = CURRENT_TIMESTAMP
              WHERE LOWER(email) = ? AND status = 'active'`,
            [trimmed]);
        }
      }
    }
  } catch (err) {
    console.error('cleanupFamilyMemberDeletion error:', err && err.message ? err.message : err);
  }
}

function normalizeRfidCredentialValue(rawValue) {
  if (rawValue == null) return '';
  return String(rawValue).trim().toUpperCase().replace(/[^0-9A-F]/g, '');
}

function hashPoolCredential(type, rawValue) {
  const normalized = (type === 'rfid' || type === 'nfc_phone')
    ? normalizeRfidCredentialValue(rawValue)
    : String(rawValue || '').trim();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

async function upsertRfidCredentialForMember(poolMemberId, rfidTag, deviceName) {
  const normalized = normalizeRfidCredentialValue(rfidTag);
  if (!normalized) {
    return { ok: false, error: 'RFID tag is invalid.' };
  }

  const hash = hashPoolCredential('rfid', normalized);
  const existing = await dbGet('SELECT * FROM pool_nfc_credentials WHERE credential_hash = ?', [hash]);

  if (existing) {
    if (existing.status === 'active' && existing.pool_member_id !== poolMemberId) {
      return { ok: false, error: 'This RFID tag is already assigned to another member.' };
    }

    await dbRun(`
      UPDATE pool_nfc_credentials
      SET pool_member_id = ?,
          credential_type = 'rfid',
          device_platform = 'card',
          device_name = ?,
          status = 'active',
          revoked_at = NULL
      WHERE id = ?
    `, [poolMemberId, deviceName || 'RFID Card', existing.id]);

    return { ok: true, id: existing.id, normalized };
  }

  const id = uuidv4();
  await dbRun(`
    INSERT INTO pool_nfc_credentials (id, pool_member_id, credential_hash, credential_type, device_platform, device_name, status)
    VALUES (?, ?, ?, 'rfid', 'card', ?, 'active')
  `, [id, poolMemberId, hash, deviceName || 'RFID Card']);

  return { ok: true, id, normalized };
}

// ── Email Setup ─────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const hasValidTwilioSid = /^AC[a-zA-Z0-9]{32}$/.test((process.env.TWILIO_ACCOUNT_SID || '').trim());
const hasValidTwilioAuthToken = !!(process.env.TWILIO_AUTH_TOKEN || '').trim() &&
  !/^your-/i.test((process.env.TWILIO_AUTH_TOKEN || '').trim());
const hasValidTwilioFromNumber = /^\+\d{10,15}$/.test((process.env.TWILIO_PHONE_NUMBER || '').trim());

const twilioClient = (twilioLib && hasValidTwilioSid && hasValidTwilioAuthToken)
  ? twilioLib(process.env.TWILIO_ACCOUNT_SID.trim(), process.env.TWILIO_AUTH_TOKEN.trim())
  : null;
const twilioFromNumber = process.env.TWILIO_PHONE_NUMBER || '';

// Verify email config on startup (non-blocking)
transporter.verify().then(() => {
  console.log('✓ Email server connection verified');
}).catch(err => {
  console.warn('⚠ Email server not configured or unreachable. Emails will be logged to console.');
  console.warn('  Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in .env');
});

async function sendEmail(to, subject, html) {
  const mailOptions = {
    from: `"${BRAND_NAME}" <${MAIL_FROM_EMAIL}>`,
    to,
    subject,
    html,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✓ Email sent to ${to}: ${subject}`);
  } catch (err) {
    // If email fails, log the details so the admin can see what would have been sent
    console.log('─── Email (not sent — SMTP not configured) ───');
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Body: ${html.replace(/<[^>]*>/g, '').substring(0, 200)}...`);
    console.log('───────────────────────────────────────────────');
  }
}

async function sendSms(to, body) {
  const normalized = normalizeUSPhone(to);
  if (!normalized) throw new Error('Invalid recipient phone number.');

  if (twilioClient && twilioFromNumber) {
    await twilioClient.messages.create({
      body,
      from: twilioFromNumber,
      to: normalized
    });
    return { sent: true, provider: 'twilio' };
  }

  // Fallback for local/dev environments without SMS provider
  console.log('─── SMS (not sent — Twilio not configured) ───');
  console.log(`  To: ${normalized}`);
  console.log(`  Body: ${body}`);
  console.log('──────────────────────────────────────────────');
  return { sent: false, provider: 'log-only' };
}

// ── Middleware ───────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
const sessionStore = new MySQLStore({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306'),
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  database:           process.env.DB_NAME     || 'glenridge',
  clearExpired:       true,
  checkExpirationInterval: 900000,
  expiration:         86400000,
  createDatabaseTable: true,
});

app.use(session({
  secret: process.env.SESSION_SECRET || 'glenridge-fallback-secret',
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// ── Passport Setup ───────────────────────────────────────
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const user = await dbGet('SELECT * FROM users WHERE id = ?', [id]);
  done(null, user || false);
});

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${SITE_URL}/api/auth/google/callback`
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value?.toLowerCase();
      let user = await dbGet('SELECT * FROM users WHERE oauth_provider = ? AND oauth_provider_id = ?', ['google', profile.id]);
      if (!user && email) {
        user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
        if (user) {
          // Link existing email account to Google
          await dbRun('UPDATE users SET oauth_provider = ?, oauth_provider_id = ? WHERE id = ?', ['google', profile.id, user.id]);
          user = await dbGet('SELECT * FROM users WHERE id = ?', [user.id]);
        }
      }
      if (user) return done(null, user);
      return done(null, false, {
        message: 'new_user', provider: 'google', providerId: profile.id,
        email, firstName: profile.name?.givenName, lastName: profile.name?.familyName
      });
    } catch (err) { done(err); }
  }));
}

if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
  passport.use(new FacebookStrategy({
    clientID: process.env.FACEBOOK_APP_ID,
    clientSecret: process.env.FACEBOOK_APP_SECRET,
    callbackURL: `${SITE_URL}/api/auth/facebook/callback`,
    profileFields: ['id', 'emails', 'name']
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value?.toLowerCase();
      let user = await dbGet('SELECT * FROM users WHERE oauth_provider = ? AND oauth_provider_id = ?', ['facebook', profile.id]);
      if (!user && email) {
        user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
        if (user) {
          await dbRun('UPDATE users SET oauth_provider = ?, oauth_provider_id = ? WHERE id = ?', ['facebook', profile.id, user.id]);
          user = await dbGet('SELECT * FROM users WHERE id = ?', [user.id]);
        }
      }
      if (user) return done(null, user);
      return done(null, false, {
        message: 'new_user', provider: 'facebook', providerId: profile.id,
        email, firstName: profile.name?.givenName, lastName: profile.name?.familyName
      });
    } catch (err) { done(err); }
  }));
}

app.use(passport.initialize());
app.use(passport.session());

// Serve static files
app.use(express.static(path.join(__dirname), {
  index: 'index.html',
  extensions: ['html']
}));

// ── Auth Middleware ──────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.status(401).json({ error: 'Not authenticated' });
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  return res.status(403).json({ error: 'Admin access required' });
}

// ── API Routes ──────────────────────────────────────────

// ── OAuth helper ────────────────────────────────────────
function handleOAuthCallback(provider) {
  return (req, res, next) => {
    passport.authenticate(provider, { session: false }, (err, user, info) => {
      if (err) {
        console.error(`${provider} OAuth error:`, err);
        return res.redirect('/members.html?oauth=error');
      }
      if (!user) {
        // New user — store pending profile in session
        req.session.pendingSocial = info;
        return res.redirect('/members.html?oauth=new_user');
      }
      if (user.status === 'pending') return res.redirect('/members.html?oauth=pending');
      if (user.status === 'denied')  return res.redirect('/members.html?oauth=denied');
      // Approved — create session
      req.session.userId    = user.id;
      req.session.userName  = `${user.first_name} ${user.last_name}`;
      req.session.userEmail = user.email;
      return res.redirect('/members.html?oauth=success');
    })(req, res, next);
  };
}

// ---------- Google OAuth ----------
app.get('/api/auth/google',
  (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.redirect('/members.html?oauth=not_configured');
    }
    passport.authenticate('google', { scope: ['profile', 'email'], session: false })(req, res, next);
  }
);
app.get('/api/auth/google/callback', handleOAuthCallback('google'));

// ---------- Facebook OAuth ----------
app.get('/api/auth/facebook',
  (req, res, next) => {
    if (!process.env.FACEBOOK_APP_ID) {
      return res.redirect('/members.html?oauth=not_configured');
    }
    passport.authenticate('facebook', { scope: ['email'], session: false })(req, res, next);
  }
);
app.get('/api/auth/facebook/callback', handleOAuthCallback('facebook'));

// ---------- Get pending social profile (for completing signup) ----------
app.get('/api/auth/pending-social', async (req, res) => {
  if (req.session.pendingSocial) {
    const { provider, email, firstName, lastName } = req.session.pendingSocial;
    res.json({ hasPending: true, provider, email, firstName, lastName });
  } else {
    res.json({ hasPending: false });
  }
});

// ---------- Complete social signup ----------
app.post('/api/auth/social-complete', async (req, res) => {
  try {
    const pending = req.session.pendingSocial;
    if (!pending) {
      return res.status(400).json({ error: 'No pending social login. Please try signing in again.' });
    }

    const { firstName, lastName, address, phone } = req.body;
    if (!firstName || !lastName || !address) {
      return res.status(400).json({ error: 'First name, last name, and address are required.' });
    }

    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'Phone number must be 10 digits.' });
    }

    if (!pending.email) {
      return res.status(400).json({ error: `Your ${pending.provider} account did not share an email address. Please sign up manually.` });
    }

    const email = pending.email.toLowerCase().trim();
    const existing = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists. Please log in instead.' });
    }

    const userId = uuidv4();
    await dbRun(`
      INSERT INTO users (id, first_name, last_name, email, address, phone, password_hash, oauth_provider, oauth_provider_id, status)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'pending')
    `, [userId, firstName.trim(), lastName.trim(), email, address.trim(), phone?.trim() || null, pending.provider, pending.providerId]);
    await dbRun(`UPDATE users SET sms_opt_out = 0, sms_unsubscribe_token = COALESCE(sms_unsubscribe_token, ?) WHERE id = ?`, [uuidv4(), userId]);

    delete req.session.pendingSocial;


    const adminUrl = `${SITE_URL}/admin.html`;
    await sendEmail(
      process.env.ADMIN_EMAIL,
      `🏡 New Resident Signup (${pending.provider}) — Approval Needed`,
      `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #2d6a4f; color: white; padding: 24px; border-radius: 12px 12px 0 0;">
          <h1 style="margin: 0; font-size: 20px;">New Resident Signup via ${pending.provider}</h1>
        </div>
        <div style="background: #f8f9fa; padding: 24px; border: 1px solid #e0e0e0;">
          <p>A new resident signed up using their ${pending.provider} account:</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px; font-weight: bold; width: 100px;">Name:</td><td style="padding: 8px;">${firstName} ${lastName}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">Email:</td><td style="padding: 8px;">${email}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">Address:</td><td style="padding: 8px;">${address}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">Phone:</td><td style="padding: 8px;">${phone || 'Not provided'}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">Provider:</td><td style="padding: 8px;">${pending.provider}</td></tr>
          </table>
          <div style="margin-top: 24px; text-align: center;">
            <a href="${adminUrl}" style="background: #2d6a4f; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; display: inline-block;">Review &amp; Approve</a>
          </div>
        </div>
        <div style="padding: 16px; text-align: center; color: #888; font-size: 13px;">${BRAND_NAME}</div>
      </div>
      `
    );

    res.json({ success: true, message: 'Your account has been submitted for approval. You will receive an email once approved.' });
  } catch (err) {
    console.error('Social complete error:', err);
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
});

// ---------- Signup ----------
app.post('/api/signup', async (req, res) => {
  try {
    const { firstName, lastName, email, address, phone, password, confirmPassword } = req.body;

    // Validation
    if (!firstName || !lastName || !email || !address || !password) {
      return res.status(400).json({ error: 'All required fields must be filled in.' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'Phone number must be 10 digits.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    // Check for existing email
    const existing = await dbGet('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // Hash password and create user
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const userId = uuidv4();

    await dbRun(`
      INSERT INTO users (id, first_name, last_name, email, address, phone, password_hash, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `, [userId, firstName.trim(), lastName.trim(), email.toLowerCase().trim(), address.trim(), phone?.trim() || null, passwordHash]);
    await dbRun(`UPDATE users SET sms_opt_out = 0, sms_unsubscribe_token = COALESCE(sms_unsubscribe_token, ?) WHERE id = ?`, [uuidv4(), userId]);

    // Send notification email to admin
    const adminUrl = `${SITE_URL}/admin.html`;
    await sendEmail(
      process.env.ADMIN_EMAIL,
      '🏡 New Resident Signup — Approval Needed',
      `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #2d6a4f; color: white; padding: 24px; border-radius: 12px 12px 0 0;">
          <h1 style="margin: 0; font-size: 20px;">New Resident Signup</h1>
        </div>
        <div style="background: #f8f9fa; padding: 24px; border: 1px solid #e0e0e0;">
          <p>A new resident has registered and is awaiting approval:</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px; font-weight: bold; width: 100px;">Name:</td><td style="padding: 8px;">${firstName} ${lastName}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">Email:</td><td style="padding: 8px;">${email}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">Address:</td><td style="padding: 8px;">${address}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">Phone:</td><td style="padding: 8px;">${phone || 'Not provided'}</td></tr>
          </table>
          <div style="margin-top: 24px; text-align: center;">
            <a href="${adminUrl}" style="background: #2d6a4f; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; display: inline-block;">Review &amp; Approve</a>
          </div>
        </div>
        <div style="padding: 16px; text-align: center; color: #888; font-size: 13px;">
          ${BRAND_NAME}
        </div>
      </div>
      `
    );

    res.json({ success: true, message: 'Your account has been submitted for approval. You will receive an email once approved.' });

  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
});

// ---------- Login ----------
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (!user.password_hash) {
      const providerName = user.oauth_provider ? user.oauth_provider.charAt(0).toUpperCase() + user.oauth_provider.slice(1) : 'a social provider';
      return res.status(401).json({ error: `This account uses ${providerName} to log in. Please use the social login button.` });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Your account is pending approval. You will receive an email once approved.' });
    }

    if (user.status === 'denied') {
      return res.status(403).json({ error: `Your account has been denied. Please contact ${ADMIN_EMAIL} for assistance.` });
    }

    // Create session
    // Create session
    req.session.userId = user.id;
    req.session.userName = `${user.first_name} ${user.last_name}`;
    req.session.userEmail = user.email;

    res.json({
      success: true,
      user: {
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
});

// ---------- Forgot Password ----------
app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email address is required.' });
    }

    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);

    // Always return success to avoid email enumeration
    if (!user || !user.password_hash) {
      return res.json({ success: true, message: 'If an account with that email exists, a password reset link has been sent.' });
    }

    // Invalidate any existing unused tokens for this user
    await dbRun('UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0', [user.id]);

    // Generate a secure random token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    await dbRun(`
      INSERT INTO password_resets (id, user_id, token_hash, expires_at)
      VALUES (?, ?, ?, ?)
    `, [uuidv4(), user.id, tokenHash, expiresAt]);

    const resetUrl = `${SITE_URL}/reset-password.html?token=${token}`;

    await sendEmail(
      user.email,
      `${BRAND_NAME} — Password Reset`,
      `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #2d6a4f; color: white; padding: 24px; border-radius: 12px 12px 0 0;">
          <h1 style="margin: 0; font-size: 20px;">Password Reset Request</h1>
        </div>
        <div style="background: #f8f9fa; padding: 24px; border: 1px solid #e0e0e0;">
          <p>Hi ${user.first_name},</p>
          <p>We received a request to reset the password for your ${BRAND_NAME} account.</p>
          <p>Click the button below to set a new password. This link will expire in 1 hour.</p>
          <div style="margin: 24px 0; text-align: center;">
            <a href="${resetUrl}" style="background: #2d6a4f; color: white; padding: 14px 36px; border-radius: 8px; text-decoration: none; display: inline-block; font-weight: bold;">Reset My Password</a>
          </div>
          <p style="color: #666; font-size: 13px;">If you didn't request this, you can safely ignore this email. Your password will not be changed.</p>
          <p style="color: #666; font-size: 13px;">If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="word-break: break-all; color: #2d6a4f; font-size: 13px;">${resetUrl}</p>
        </div>
        <div style="padding: 16px; text-align: center; color: #888; font-size: 13px;">${BRAND_NAME}</div>
      </div>
      `
    );

    res.json({ success: true, message: 'If an account with that email exists, a password reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
});

// ---------- Reset Password ----------
app.post('/api/reset-password', async (req, res) => {
  try {
    const { token, password, confirmPassword } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Token and new password are required.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const resetRecord = await dbGet(
      'SELECT * FROM password_resets WHERE token_hash = ? AND used = 0',
      [tokenHash]
    );

    if (!resetRecord) {
      return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
    }

    if (new Date(resetRecord.expires_at) < new Date()) {
      await dbRun('UPDATE password_resets SET used = 1 WHERE id = ?', [resetRecord.id]);
      return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });
    }

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [resetRecord.user_id]);
    if (!user) {
      return res.status(400).json({ error: 'Account not found.' });
    }

    // Update the password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await dbRun('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, user.id]);

    // Mark the token as used
    await dbRun('UPDATE password_resets SET used = 1 WHERE id = ?', [resetRecord.id]);

    res.json({ success: true, message: 'Your password has been reset successfully. You can now log in with your new password.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
});

// ---------- Logout ----------
app.post('/api/logout', async (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ---------- Get current user ----------
app.get('/api/me', async (req, res) => {
  if (req.session && req.session.userId) {
    res.json({
      authenticated: true,
      user: {
        firstName: req.session.userName?.split(' ')[0],
        lastName: req.session.userName?.split(' ').slice(1).join(' '),
        email: req.session.userEmail
      }
    });
  } else {
    res.json({ authenticated: false });
  }
});

// ── SMS Preference Routes (member-facing) ──────────────────
app.get('/api/sms/preferences', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const user = await dbGet(`SELECT id, status, phone, sms_opt_out FROM users WHERE id = ?`, [userId]);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const hasPhone = !!normalizeUSPhone(user.phone);
  const optedOut = !!user.sms_opt_out;
  const canReceiveSms = user.status === 'approved' && hasPhone && !optedOut;

  // Household members enrolled in SMS
  const adults = await dbAll('SELECT id, name, phone, sms_opt_in FROM dir_adults WHERE user_id = ?', [userId]);
  const children = await dbAll('SELECT id, first_name, phone, is_16_plus, sms_opt_in FROM dir_children WHERE user_id = ?', [userId]);
  const householdSms = [];
  adults.filter(a => a.sms_opt_in && normalizeUSPhone(a.phone)).forEach(a => {
    householdSms.push({ id: a.id, type: 'adult', name: a.name, phoneMasked: maskPhone(a.phone) });
  });
  children.filter(c => c.is_16_plus && c.sms_opt_in && normalizeUSPhone(c.phone)).forEach(c => {
    householdSms.push({ id: c.id, type: 'child', name: c.first_name, phoneMasked: maskPhone(c.phone) });
  });

  res.json({
    hasPhone,
    phoneMasked: hasPhone ? maskPhone(user.phone) : null,
    optedOut,
    canReceiveSms,
    householdSms
  });
});

app.post('/api/sms/preferences', requireAuth, async (req, res) => {
  const optedOut = !!req.body.opted_out;
  await dbRun(`
    UPDATE users
    SET sms_opt_out = ?,
        sms_unsubscribe_token = COALESCE(sms_unsubscribe_token, ?)
    WHERE id = ?
  `, [optedOut ? 1 : 0, uuidv4(), req.session.userId]);

  res.json({ success: true, message: optedOut ? 'You have opted out of HOA text messages.' : 'You are now subscribed to HOA text messages.' });
});

// Public SMS unsubscribe link endpoint
app.get('/api/sms/unsubscribe', async (req, res) => {
  const token = (req.query.token || '').toString().trim();
  if (!token) return res.status(400).json({ error: 'Missing token.' });

  const user = await dbGet(`SELECT id, sms_opt_out FROM users WHERE sms_unsubscribe_token = ?`, [token]);
  if (!user) return res.status(404).json({ error: 'Invalid unsubscribe token.' });

  if (!user.sms_opt_out) {
    await dbRun(`UPDATE users SET sms_opt_out = 1 WHERE id = ?`, [user.id]);
  }

  res.json({ success: true });
});

// ── Community Events Routes ──────────────────────────────

// Get all events (members only)
app.get('/api/events', requireAuth, async (req, res) => {
  const events = await dbAll(`
    SELECT * FROM community_events ORDER BY event_date ASC, event_time ASC
  `);
  res.json(events);
});

// Create event (members only)
app.post('/api/events', requireAuth, async (req, res) => {
  try {
    const { title, description, event_date, event_time, location } = req.body;
    if (!title || !event_date) {
      return res.status(400).json({ error: 'Title and date are required.' });
    }
    // Validate date format YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(event_date)) {
      return res.status(400).json({ error: 'Invalid date format.' });
    }
    const id = uuidv4();
    await dbRun(`
      INSERT INTO community_events (id, title, description, event_date, event_time, location, created_by_id, created_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, title.trim(), description?.trim() || null, event_date, event_time?.trim() || null, location?.trim() || null,
        req.session.userId, req.session.userName]);
    const event = await dbGet('SELECT * FROM community_events WHERE id = ?', [id]);

    // Format date/time for email
    const [y, m, d] = event_date.split('-').map(Number);
    const dateFmt = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    let timeFmt = 'All day';
    if (event_time) {
      const [h, min] = event_time.split(':').map(Number);
      timeFmt = `${h % 12 || 12}:${String(min).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
    }

    await sendEmail(
      process.env.ADMIN_EMAIL,
      `📅 New Community Event Added — ${title.trim()}`,
      `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#2d6a4f;color:#fff;padding:24px;border-radius:12px 12px 0 0;">
          <h1 style="margin:0;font-size:20px;">New Community Event</h1>
        </div>
        <div style="background:#f8f9fa;padding:24px;border:1px solid #e0e0e0;">
          <p>A member has added a new event to the community calendar:</p>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px;font-weight:bold;width:100px;">Event:</td><td style="padding:8px;">${title.trim()}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;">Date:</td><td style="padding:8px;">${dateFmt}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;">Time:</td><td style="padding:8px;">${timeFmt}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;">Location:</td><td style="padding:8px;">${location?.trim() || 'Not specified'}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;">Description:</td><td style="padding:8px;">${description?.trim() || 'None'}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;">Added by:</td><td style="padding:8px;">${req.session.userName}</td></tr>
          </table>
          <div style="margin-top:24px;text-align:center;">
            <a href="${SITE_URL}/members.html" style="background:#2d6a4f;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;display:inline-block;">View Calendar</a>
          </div>
        </div>
        <div style="padding:16px;text-align:center;color:#888;font-size:13px;">${BRAND_NAME}</div>
      </div>
      `
    );

    res.json({ success: true, event });
  } catch (err) {
    console.error('Create event error:', err);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
});

// Delete event (owner or admin)
app.delete('/api/events/:id', requireAuth, async (req, res) => {
  const event = await dbGet('SELECT * FROM community_events WHERE id = ?', [req.params.id]);
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  if (event.created_by_id !== req.session.userId && !req.session.isAdmin) {
    return res.status(403).json({ error: 'You can only delete your own events.' });
  }
  await dbRun('DELETE FROM community_events WHERE id = ?', [req.params.id]);

  // Format date for email
  const [y, m, d] = event.event_date.split('-').map(Number);
  const dateFmt = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const deletedBy = req.session.isAdmin && event.created_by_id !== req.session.userId
    ? `${req.session.userName} (admin)`
    : req.session.userName;

  await sendEmail(
    process.env.ADMIN_EMAIL,
    `🗑️ Community Event Deleted — ${event.title}`,
    `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#c0392b;color:#fff;padding:24px;border-radius:12px 12px 0 0;">
        <h1 style="margin:0;font-size:20px;">Community Event Deleted</h1>
      </div>
      <div style="background:#f8f9fa;padding:24px;border:1px solid #e0e0e0;">
        <p>A community calendar event has been removed:</p>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:8px;font-weight:bold;width:120px;">Event:</td><td style="padding:8px;">${event.title}</td></tr>
          <tr><td style="padding:8px;font-weight:bold;">Date:</td><td style="padding:8px;">${dateFmt}</td></tr>
          <tr><td style="padding:8px;font-weight:bold;">Location:</td><td style="padding:8px;">${event.location || 'Not specified'}</td></tr>
          <tr><td style="padding:8px;font-weight:bold;">Originally added by:</td><td style="padding:8px;">${event.created_by_name}</td></tr>
          <tr><td style="padding:8px;font-weight:bold;">Deleted by:</td><td style="padding:8px;">${deletedBy}</td></tr>
        </table>
      </div>
      <div style="padding:16px;text-align:center;color:#888;font-size:13px;">${BRAND_NAME}</div>
    </div>
    `
  );

  res.json({ success: true });
});

// ── Directory Routes ────────────────────────────────────

// Multer storage for member photos
const dirPhotosBase = path.join(__dirname, 'images', 'directory');
if (!fs.existsSync(dirPhotosBase)) fs.mkdirSync(dirPhotosBase, { recursive: true });

const dirStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userDir = path.join(dirPhotosBase, req.session.userId);
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  }
});
const dirUpload = multer({
  storage: dirStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Only JPG, PNG, and WEBP files are allowed.'));
  }
});

async function dirAudit(userId, action, detail) {
  try { await dbRun('INSERT INTO dir_audit (id,user_id,action,detail) VALUES (?,?,?,?)', [uuidv4(), userId, action, detail || null]); } catch (e) {}
}

async function buildProfile(userId) {
  const user    = await dbGet('SELECT first_name, last_name, email, address FROM users WHERE id=?', [userId]);
  const profile = await dbGet('SELECT * FROM dir_profiles WHERE user_id=?', [userId]);
  const adults  = await dbAll('SELECT * FROM dir_adults WHERE user_id=? ORDER BY id', [userId]);
  const children= await dbAll('SELECT * FROM dir_children WHERE user_id=? ORDER BY id', [userId]);
  const pets    = await dbAll('SELECT * FROM dir_pets WHERE user_id=? ORDER BY id', [userId]);
  const social  = await dbAll('SELECT * FROM dir_social WHERE user_id=? ORDER BY id', [userId]);
  const photos  = await dbAll('SELECT * FROM dir_photos WHERE user_id=? ORDER BY display_order, uploaded_at', [userId]);
  return { user, profile, adults, children, pets, social, photos };
}

// GET /api/directory - list all approved members (opt-out model: hidden only if do_not_list=1)
app.get('/api/directory', requireAuth, async (req, res) => {
  try {
    // Exclude users who have explicitly opted out via do_not_list at the SQL level
    const approvedUsers = await dbAll(`
      SELECT u.id FROM users u
      LEFT JOIN dir_profiles p ON p.user_id = u.id
      WHERE u.status = 'approved'
        AND (p.do_not_list IS NULL OR p.do_not_list = 0)
    `);
    const profiles = await Promise.all(approvedUsers.map(row => buildProfile(row.id)));
    const result = profiles
      .filter(p => {
        if (!p.user) return false;
        // Defense in depth: also drop here in case the join missed something
        if (p.profile && p.profile.do_not_list) return false;
        return true;
      })
      .sort((a, b) => {
        const nameA = (a.profile && a.profile.display_name) || `${a.user.last_name} ${a.user.first_name}`;
        const nameB = (b.profile && b.profile.display_name) || `${b.user.last_name} ${b.user.first_name}`;
        return nameA.localeCompare(nameB);
      });
    res.json(result);
  } catch (err) {
    console.error('GET /api/directory error:', err.message);
    res.status(500).json({ error: 'Failed to load directory.' });
  }
});

// GET /api/directory/me - get my full profile
app.get('/api/directory/me', requireAuth, async (req, res) => {
  try {
    res.json(await buildProfile(req.session.userId));
  } catch (err) {
    console.error('GET /api/directory/me error:', err.message);
    res.status(500).json({ error: 'Failed to load profile.' });
  }
});

// POST /api/directory/profile - create or update core profile
app.post('/api/directory/profile', requireAuth, async (req, res) => {
  const uid = req.session.userId;
  const { display_name, phone, show_phone, show_email, anniversary, show_anniversary,
          interests, show_interests, notes, show_notes, do_not_list, is_published, consent_given } = req.body;
  const existing = await dbGet('SELECT id FROM dir_profiles WHERE user_id=?', [uid]);
  if (existing) {
    await dbRun(`UPDATE dir_profiles SET display_name=?,phone=?,show_phone=?,show_email=?,anniversary=?,show_anniversary=?,
      interests=?,show_interests=?,notes=?,show_notes=?,do_not_list=?,is_published=?,consent_given=?,updated_at=CURRENT_TIMESTAMP
      WHERE user_id=?`,
      [display_name||null, phone||null, show_phone?1:0, show_email?1:0,
       anniversary||null, show_anniversary?1:0, interests||null, show_interests?1:0,
       notes||null, show_notes?1:0, do_not_list?1:0, is_published?1:0, consent_given?1:0, uid]);
  } else {
    await dbRun(`INSERT INTO dir_profiles (id,user_id,display_name,phone,show_phone,show_email,anniversary,show_anniversary,
      interests,show_interests,notes,show_notes,do_not_list,is_published,consent_given)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [uuidv4(), uid, display_name||null, phone||null, show_phone?1:0, show_email?1:0,
       anniversary||null, show_anniversary?1:0, interests||null, show_interests?1:0,
       notes||null, show_notes?1:0, do_not_list?1:0, is_published?1:0, consent_given?1:0]);
  }
  // Sync profile phone to users.phone so it becomes the default SMS contact number
  if (phone !== undefined) {
    await dbRun(`UPDATE users SET phone = ? WHERE id = ?`, [phone?.trim() || null, uid]);
  }
  dirAudit(uid, 'profile_updated', null);
  res.json({ success: true, profile: await buildProfile(uid) });
});

// POST /api/directory/adults
app.post('/api/directory/adults', requireAuth, async (req, res) => {
  const { name, birthday, show_birthday, phone, email, is_visible } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  if (email && !isValidEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (phone && !isValidPhone(phone)) return res.status(400).json({ error: 'Phone number must be 10 digits.' });
  const sms_opt_in_val = req.body.sms_opt_in ? 1 : 0;
  const id = uuidv4();
  await dbRun('INSERT INTO dir_adults (id,user_id,name,birthday,show_birthday,phone,email,is_visible,sms_opt_in) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, req.session.userId, name.trim(), birthday||null, show_birthday?1:0, phone?.trim()||null, email?.trim()||null, is_visible!==false?1:0, sms_opt_in_val]);
  res.json({ success: true, adult: await dbGet('SELECT * FROM dir_adults WHERE id=?', [id]) });
});
app.put('/api/directory/adults/:id', requireAuth, async (req, res) => {
  const { phone, email } = req.body;
  if (email && !isValidEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (phone && !isValidPhone(phone)) return res.status(400).json({ error: 'Phone number must be 10 digits.' });
  const row = await dbGet('SELECT * FROM dir_adults WHERE id=? AND user_id=?', [req.params.id, req.session.userId]);
  if (!row) return res.status(404).json({ error: 'Adult not found.' });
  const sms_opt_in_val = req.body.sms_opt_in !== undefined ? (req.body.sms_opt_in ? 1 : 0) : (row.sms_opt_in || 0);
  await dbRun('UPDATE dir_adults SET phone=?, email=?, sms_opt_in=? WHERE id=? AND user_id=?',
    [phone?.trim()||null, email?.trim()||null, sms_opt_in_val, req.params.id, req.session.userId]);
  res.json({ success: true, adult: await dbGet('SELECT * FROM dir_adults WHERE id=?', [req.params.id]) });
});
app.delete('/api/directory/adults/:id', requireAuth, async (req, res) => {
  const row = await dbGet('SELECT * FROM dir_adults WHERE id=? AND user_id=?', [req.params.id, req.session.userId]);
  if (!row) return res.json({ success: true });
  await cleanupFamilyMemberDeletion({ personType: 'adult', personId: row.id, email: row.email, ownerUserId: req.session.userId });
  await dbRun('DELETE FROM dir_adults WHERE id=? AND user_id=?', [req.params.id, req.session.userId]);
  res.json({ success: true });
});

// POST /api/directory/children
app.post('/api/directory/children', requireAuth, async (req, res) => {
  const { first_name, birth_month, birth_day, show_birthday, is_visible, is_16_plus, phone, email } = req.body;
  if (!first_name) return res.status(400).json({ error: 'First name is required.' });
  if (email && !isValidEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (phone && !isValidPhone(phone)) return res.status(400).json({ error: 'Phone number must be 10 digits.' });
  const sms_opt_in_val = req.body.sms_opt_in ? 1 : 0;
  const id = uuidv4();
  await dbRun('INSERT INTO dir_children (id,user_id,first_name,birth_month,birth_day,show_birthday,is_visible,is_16_plus,phone,email,sms_opt_in) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [id, req.session.userId, first_name.trim(), birth_month||null, birth_day||null, show_birthday?1:0, is_visible!==false?1:0, is_16_plus?1:0, phone?.trim()||null, email?.trim()||null, sms_opt_in_val]);
  res.json({ success: true, child: await dbGet('SELECT * FROM dir_children WHERE id=?', [id]) });
});
app.put('/api/directory/children/:id', requireAuth, async (req, res) => {
  const { is_16_plus, phone, email } = req.body;
  if (email && !isValidEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (phone && !isValidPhone(phone)) return res.status(400).json({ error: 'Phone number must be 10 digits.' });
  const row = await dbGet('SELECT * FROM dir_children WHERE id=? AND user_id=?', [req.params.id, req.session.userId]);
  if (!row) return res.status(404).json({ error: 'Child not found.' });
  const sms_opt_in_val = req.body.sms_opt_in !== undefined ? (req.body.sms_opt_in ? 1 : 0) : (row.sms_opt_in || 0);
  await dbRun('UPDATE dir_children SET is_16_plus=?, phone=?, email=?, sms_opt_in=? WHERE id=? AND user_id=?',
    [is_16_plus?1:0, phone?.trim()||null, email?.trim()||null, sms_opt_in_val, req.params.id, req.session.userId]);
  res.json({ success: true, child: await dbGet('SELECT * FROM dir_children WHERE id=?', [req.params.id]) });
});
app.delete('/api/directory/children/:id', requireAuth, async (req, res) => {
  const row = await dbGet('SELECT * FROM dir_children WHERE id=? AND user_id=?', [req.params.id, req.session.userId]);
  if (!row) return res.json({ success: true });
  await cleanupFamilyMemberDeletion({ personType: 'child', personId: row.id, email: row.email, ownerUserId: req.session.userId });
  await dbRun('DELETE FROM dir_children WHERE id=? AND user_id=?', [req.params.id, req.session.userId]);
  res.json({ success: true });
});

// POST /api/directory/pets
app.post('/api/directory/pets', requireAuth, async (req, res) => {
  const { name, pet_type, is_visible } = req.body;
  if (!name) return res.status(400).json({ error: 'Pet name is required.' });
  const id = uuidv4();
  await dbRun('INSERT INTO dir_pets (id,user_id,name,pet_type,is_visible) VALUES (?,?,?,?,?)',
    [id, req.session.userId, name.trim(), pet_type||null, is_visible!==false?1:0]);
  res.json({ success: true, pet: await dbGet('SELECT * FROM dir_pets WHERE id=?', [id]) });
});
app.delete('/api/directory/pets/:id', requireAuth, async (req, res) => {
  await dbRun('DELETE FROM dir_pets WHERE id=? AND user_id=?', [req.params.id, req.session.userId]);
  res.json({ success: true });
});

// POST /api/directory/social
app.post('/api/directory/social', requireAuth, async (req, res) => {
  const { platform, url, is_visible } = req.body;
  if (!platform || !url) return res.status(400).json({ error: 'Platform and URL are required.' });
  const id = uuidv4();
  await dbRun('INSERT INTO dir_social (id,user_id,platform,url,is_visible) VALUES (?,?,?,?,?)',
    [id, req.session.userId, platform.trim(), url.trim(), is_visible!==false?1:0]);
  res.json({ success: true, social: await dbGet('SELECT * FROM dir_social WHERE id=?', [id]) });
});
app.delete('/api/directory/social/:id', requireAuth, async (req, res) => {
  await dbRun('DELETE FROM dir_social WHERE id=? AND user_id=?', [req.params.id, req.session.userId]);
  res.json({ success: true });
});

// POST /api/directory/photos
app.post('/api/directory/photos', requireAuth, async (req, res) => {
  dirUpload.single('photo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const photoCount = (await dbAll('SELECT id FROM dir_photos WHERE user_id=?', [req.session.userId])).length;
    if (photoCount >= 20) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Maximum of 20 photos allowed.' });
    }
    const { category, caption } = req.body;
    const id = uuidv4();
    const webPath = `/images/directory/${req.session.userId}/${req.file.filename}`;
    await dbRun('INSERT INTO dir_photos (id,user_id,filename,category,caption,display_order) VALUES (?,?,?,?,?,?)',
      [id, req.session.userId, webPath, category||'Household', caption||null, photoCount]);
    dirAudit(req.session.userId, 'photo_uploaded', req.file.filename);
    res.json({ success: true, photo: await dbGet('SELECT * FROM dir_photos WHERE id=?', [id]) });
  });
});
app.put('/api/directory/photos/:id', requireAuth, async (req, res) => {
  const { caption, is_visible, category, display_order } = req.body;
  await dbRun(`UPDATE dir_photos SET caption=?,is_visible=?,category=?,display_order=? WHERE id=? AND user_id=?`,
    [caption||null, is_visible?1:0, category||'Household', display_order||0, req.params.id, req.session.userId]);
  res.json({ success: true });
});
app.delete('/api/directory/photos/:id', requireAuth, async (req, res) => {
  const photo = await dbGet('SELECT * FROM dir_photos WHERE id=? AND user_id=?', [req.params.id, req.session.userId]);
  if (!photo) return res.status(404).json({ error: 'Photo not found.' });
  const fullPath = path.join(__dirname, photo.filename);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  await dbRun('DELETE FROM dir_photos WHERE id=?', [req.params.id]);
  dirAudit(req.session.userId, 'photo_deleted', photo.filename);
  res.json({ success: true });
});

// GET /api/directory/print
app.get('/api/directory/print', requireAuth, async (req, res) => {
  dirAudit(req.session.userId, 'print_generated', null);
  const approvedUsers = await dbAll(`
    SELECT u.id FROM users u
    LEFT JOIN dir_profiles p ON p.user_id = u.id
    WHERE u.status = 'approved'
      AND (p.do_not_list IS NULL OR p.do_not_list = 0)
  `);
  const profiles = await Promise.all(approvedUsers.map(row => buildProfile(row.id)));
  const result = profiles
    .filter(p => p.user && !(p.profile && p.profile.do_not_list))
    .sort((a, b) => {
      const nameA = (a.profile && a.profile.display_name) || `${a.user.last_name} ${a.user.first_name}`;
      const nameB = (b.profile && b.profile.display_name) || `${b.user.last_name} ${b.user.first_name}`;
      return nameA.localeCompare(nameB);
    });
  res.json(result);
});

// ── Pool Phone Access (per-person phone credentials) ────────────
//
// A household member may register one phone (iPhone or Android) for
// themselves and for each adult / child on their profile. The admin is
// notified of the phone type and sends the appropriate wallet pass via email.

// Map a (user_id, person_type, person_id) to the corresponding pool_members
// row. Returns the pool_member object or null when admin has not enrolled
// the person as an active pool guest yet.
async function findPoolMemberForPerson(userId, personType, personId) {
  if (personType === 'self') {
    return await dbGet(
      `SELECT * FROM pool_members WHERE user_id=? AND status='active' LIMIT 1`,
      [userId]);
  }
  if (personType === 'adult' && personId) {
    return await dbGet(
      `SELECT * FROM pool_members WHERE notes=? AND status='active' LIMIT 1`,
      [`family_adult_${personId}`]);
  }
  if (personType === 'child' && personId) {
    return await dbGet(
      `SELECT * FROM pool_members WHERE notes=? AND status='active' LIMIT 1`,
      [`family_child_${personId}`]);
  }
  return null;
}

// Resolve a friendly display name for the registered person.
async function resolvePersonName(userId, personType, personId) {
  if (personType === 'self') {
    const u = await dbGet('SELECT first_name, last_name FROM users WHERE id=?', [userId]);
    return u ? `${u.first_name} ${u.last_name}` : 'Member';
  }
  if (personType === 'adult' && personId) {
    const a = await dbGet('SELECT name FROM dir_adults WHERE id=? AND user_id=?', [personId, userId]);
    return a ? a.name : null;
  }
  if (personType === 'child' && personId) {
    const c = await dbGet('SELECT first_name FROM dir_children WHERE id=? AND user_id=?', [personId, userId]);
    return c ? c.first_name : null;
  }
  return null;
}

// Decorate a phone row with active-guest status (recomputed on read so the
// UI always reflects the admin's current pool_members state).
function decoratePhone(row) {
  if (!row) return null;
  const pm = findPoolMemberForPerson(row.user_id, row.person_type, row.person_id);
  return {
    id: row.id,
    person_type: row.person_type,
    person_id: row.person_id,
    person_name: row.person_name,
    device_platform: row.device_platform,
    device_label: row.device_label,
    wallet_pass_status: row.wallet_pass_status || 'pending',
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    revoked_at: row.revoked_at,
    is_active_guest: !!pm,
    pool_member_id: pm ? pm.id : null
  };
}

// GET /api/directory/me/pool-phones — list all phones for my household
app.get('/api/directory/me/pool-phones', requireAuth, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT * FROM dir_pool_phones WHERE user_id=? ORDER BY created_at`,
      [req.session.userId]);
    res.json({ phones: rows.map(decoratePhone) });
  } catch (err) {
    console.error('GET /api/directory/me/pool-phones error:', err.message);
    res.status(500).json({ error: 'Failed to load pool phones.' });
  }
});

// POST /api/directory/me/pool-phones — register or replace the phone for
// a specific household person. Records the phone type (iPhone/Android)
// so the admin knows which wallet pass to send via email.
app.post('/api/directory/me/pool-phones', requireAuth, async (req, res) => {
  try {
    const uid = req.session.userId;
    const { person_type, person_id, device_platform, device_label } = req.body || {};

    if (!['self', 'adult', 'child'].includes(person_type)) {
      return res.status(400).json({ error: 'person_type must be self, adult, or child.' });
    }
    if (!['ios', 'android'].includes(device_platform)) {
      return res.status(400).json({ error: 'device_platform must be ios or android.' });
    }
    if (person_type !== 'self' && !person_id) {
      return res.status(400).json({ error: 'person_id is required for adult/child registrations.' });
    }

    const personName = resolvePersonName(uid, person_type, person_type === 'self' ? null : person_id);
    if (!personName) {
      return res.status(404).json({ error: 'Household person not found.' });
    }

    // Revoke any prior active phone for this person (one phone per person)
    await dbRun(
      `UPDATE dir_pool_phones SET status='revoked', revoked_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
       WHERE user_id=? AND person_type=? AND ((person_id IS NULL AND ? IS NULL) OR person_id=?) AND status='active'`,
      [uid, person_type, person_type === 'self' ? null : person_id, person_type === 'self' ? null : person_id]);

    const id = uuidv4();
    const pm = findPoolMemberForPerson(uid, person_type, person_type === 'self' ? null : person_id);

    await dbRun(
      `INSERT INTO dir_pool_phones
        (id, user_id, person_type, person_id, person_name, device_platform, device_label,
         credential_token_hash, pool_member_id, wallet_pass_status, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [id, uid, person_type, person_type === 'self' ? null : person_id, personName,
       device_platform, (device_label || '').trim() || null, '', pm ? pm.id : null]);

    dirAudit(uid, 'pool_phone_registered',
      `${personName} (${person_type}) — ${device_platform}${device_label ? ' / ' + device_label : ''}`);

    const row = await dbGet('SELECT * FROM dir_pool_phones WHERE id=?', [id]);
    res.json({
      success: true,
      phone: decoratePhone(row)
    });
  } catch (err) {
    console.error('POST /api/directory/me/pool-phones error:', err.message);
    res.status(500).json({ error: 'Failed to register phone.' });
  }
});

// DELETE /api/directory/me/pool-phones/:id — revoke a phone
app.delete('/api/directory/me/pool-phones/:id', requireAuth, async (req, res) => {
  try {
    const uid = req.session.userId;
    const row = await dbGet('SELECT * FROM dir_pool_phones WHERE id=? AND user_id=?',
      [req.params.id, uid]);
    if (!row) return res.status(404).json({ error: 'Phone not found.' });

    await dbRun(
      `UPDATE dir_pool_phones SET status='revoked', revoked_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
       WHERE id=? AND user_id=?`,
      [req.params.id, uid]);

    dirAudit(uid, 'pool_phone_revoked', `${row.person_name} — ${row.device_platform}`);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/directory/me/pool-phones error:', err.message);
    res.status(500).json({ error: 'Failed to revoke phone.' });
  }
});

// ── Admin Routes ────────────────────────────────────────

// Admin login
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;

  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    req.session.save(err => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: 'Session error. Please try again.' });
      }
      res.json({ success: true });
    });
  } else {
    res.status(401).json({ error: 'Invalid username or password.' });
  }
});

// Admin logout
app.post('/api/admin/logout', async (req, res) => {
  req.session.isAdmin = false;
  req.session.destroy();
  res.json({ success: true });
});

// Check admin status
app.get('/api/admin/status', async (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// Get all pending users
app.get('/api/admin/users/pending', requireAdmin, async (req, res) => {
  const users = await dbAll(`
    SELECT id, first_name, last_name, email, address, phone, status, created_at
    FROM users WHERE status = 'pending'
    ORDER BY created_at DESC
  `);
  res.json(users);
});

// Get all users
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const users = await dbAll(`
    SELECT id, first_name, last_name, email, address, phone, status, created_at, approved_at
    FROM users
    ORDER BY created_at DESC
  `);
  // Attach household adults & children for each user (approved users typically have them)
  for (const u of users) {
    try {
      u.adults = await dbAll(
        `SELECT id, name, email, phone, sms_opt_in
           FROM dir_adults WHERE user_id = ? ORDER BY name ASC`,
        [u.id]);
    } catch { u.adults = []; }
    try {
      u.children = await dbAll(
        `SELECT id, first_name, phone, is_16_plus, sms_opt_in
           FROM dir_children WHERE user_id = ? ORDER BY first_name ASC`,
        [u.id]);
    } catch { u.children = []; }
  }
  res.json(users);
});

// SMS recipient preview (admin-only)
app.get('/api/admin/sms/recipients', requireAdmin, async (req, res) => {
  const users = await dbAll(`
    SELECT id, first_name, last_name, phone, status, sms_opt_out
    FROM users
    WHERE status = 'approved'
    ORDER BY last_name ASC, first_name ASC
  `);

  const recipients = users
    .map(u => ({
      ...u,
      normalized_phone: normalizeUSPhone(u.phone)
    }))
    .filter(u => !!u.normalized_phone && !u.sms_opt_out)
    .map(u => ({
      id: u.id,
      name: `${u.first_name} ${u.last_name}`,
      phoneMasked: maskPhone(u.phone)
    }));

  // Include opted-in household members (adults & 16+ children)
  const householdRecipients = [];
  const approvedUserIds = users.filter(u => !u.sms_opt_out).map(u => u.id);
  for (const uid of approvedUserIds) {
    const adults = await dbAll('SELECT name, phone, sms_opt_in FROM dir_adults WHERE user_id = ?', [uid]);
    adults.filter(a => a.sms_opt_in && normalizeUSPhone(a.phone)).forEach(a => {
      householdRecipients.push({ id: uid, name: a.name, phoneMasked: maskPhone(a.phone) });
    });
    const children = await dbAll('SELECT first_name, phone, is_16_plus, sms_opt_in FROM dir_children WHERE user_id = ?', [uid]);
    children.filter(c => c.is_16_plus && c.sms_opt_in && normalizeUSPhone(c.phone)).forEach(c => {
      householdRecipients.push({ id: uid, name: c.first_name, phoneMasked: maskPhone(c.phone) });
    });
  }

  res.json({
    eligibleCount: recipients.length + householdRecipients.length,
    recipients: [...recipients, ...householdRecipients]
  });
});

// Send SMS broadcast (admin-only)
app.post('/api/admin/sms/send', requireAdmin, async (req, res) => {
  try {
    const message = (req.body.message || '').toString().trim();
    if (!message) return res.status(400).json({ error: 'Message is required.' });
    if (message.length > 1200) return res.status(400).json({ error: 'Message is too long.' });

    const users = await dbAll(`
      SELECT id, first_name, last_name, phone, sms_unsubscribe_token, sms_opt_out
      FROM users
      WHERE status = 'approved'
    `);

    const eligible = users.filter(u => !u.sms_opt_out && normalizeUSPhone(u.phone));

    // Collect opted-in household member phones
    const householdPhones = [];
    const approvedUserIds = users.filter(u => !u.sms_opt_out).map(u => u.id);
    for (const uid of approvedUserIds) {
      const unsub = users.find(u => u.id === uid);
      const unsubToken = unsub ? unsub.sms_unsubscribe_token : '';
      const adults = await dbAll('SELECT phone, sms_opt_in FROM dir_adults WHERE user_id = ?', [uid]);
      adults.filter(a => a.sms_opt_in && normalizeUSPhone(a.phone)).forEach(a => {
        householdPhones.push({ phone: a.phone, sms_unsubscribe_token: unsubToken });
      });
      const children = await dbAll('SELECT phone, is_16_plus, sms_opt_in FROM dir_children WHERE user_id = ?', [uid]);
      children.filter(c => c.is_16_plus && c.sms_opt_in && normalizeUSPhone(c.phone)).forEach(c => {
        householdPhones.push({ phone: c.phone, sms_unsubscribe_token: unsubToken });
      });
    }

    const allRecipients = [
      ...eligible.map(u => ({ phone: u.phone, sms_unsubscribe_token: u.sms_unsubscribe_token })),
      ...householdPhones
    ];

    if (!allRecipients.length) {
      return res.status(400).json({ error: 'No eligible recipients with valid phone numbers.' });
    }

    let sent = 0;
    let failed = 0;
    for (const r of allRecipients) {
      const unsubUrl = `${siteUrl()}/unsubscribe.html?channel=sms&token=${encodeURIComponent(r.sms_unsubscribe_token || '')}`;
      const finalMessage = `${message}\n\nOpt out: ${unsubUrl}`;
      try {
        await sendSms(r.phone, finalMessage);
        sent++;
      } catch (err) {
        failed++;
        console.warn(`SMS send failed for ${r.phone}:`, err.message);
      }
    }

    const note = (twilioClient && twilioFromNumber)
      ? null
      : 'Twilio is not configured. Messages were logged to the server console.';

    // Log the broadcast in history
    try {
      const adminUser = await dbGet('SELECT email FROM users WHERE id = ?', [req.session.userId]);
      const broadcastId = uuidv4();
      const sentAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const sentBy = (adminUser && adminUser.email) ? String(adminUser.email) : 'admin';
      const noteVal = note == null ? '' : String(note);
      await dbRun(
        `INSERT INTO sms_broadcasts (id, sent_at, sent_by, message, recipients_total, sent_count, failed_count, note)
         VALUES (?,?,?,?,?,?,?,?)`,
        [broadcastId, sentAt, sentBy, String(message), Number(allRecipients.length) || 0, Number(sent) || 0, Number(failed) || 0, noteVal]);
      console.log(`✓ Logged SMS broadcast ${broadcastId} (sent=${sent} failed=${failed} total=${allRecipients.length})`);
    } catch (logErr) {
      console.warn('Failed to record SMS broadcast history:', logErr && (logErr.stack || logErr.message || logErr));
    }

    res.json({
      success: true,
      sent,
      failed,
      totalEligible: allRecipients.length,
      note
    });
  } catch (err) {
    console.error('Admin SMS send error:', err);
    res.status(500).json({ error: 'Failed to send SMS broadcast.' });
  }
});

// SMS broadcast history (admin-only)
app.get('/api/admin/sms/history', requireAdmin, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const rows = await dbAll(
    `SELECT id, sent_at, sent_by, message, recipients_total, sent_count, failed_count, note
       FROM sms_broadcasts
      ORDER BY sent_at DESC
      LIMIT ?`,
    [limit]);
  res.json(rows);
});

// Approve user
app.post('/api/admin/users/:id/approve', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [id]);

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await dbRun(`
      UPDATE users SET status = 'approved', approved_at = CURRENT_TIMESTAMP, approved_by = 'admin'
      WHERE id = ?
    `, [id]);

    // Send approval email to the resident
    await sendEmail(
      user.email,
      `Welcome to the ${BRAND_SHORT} Website!`,
      `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #2d6a4f; color: white; padding: 24px; border-radius: 12px 12px 0 0;">
          <h1 style="margin: 0; font-size: 20px;">Welcome to the ${BRAND_SHORT}!</h1>
        </div>
        <div style="background: #f8f9fa; padding: 24px; border: 1px solid #e0e0e0;">
          <p>Hello ${user.first_name},</p>
          <p>Welcome to the ${BRAND_SHORT} website! Your new member account has been successfully created.</p>
          <p>Your account will be used for several important community features, including:</p>
          <ul style="line-height: 2;">
            <li>Community Newsletters &amp; Announcements</li>
            <li>SMS Text Alerts &amp; Notices</li>
            <li>Pool Gate Access</li>
            <li>Member Directory Access</li>
          </ul>

          <h2 style="color: #2d6a4f; font-size: 17px; margin-top: 28px;">Next Steps</h2>

          <h3 style="font-size: 15px; margin-bottom: 4px;">1. Login to Your Account</h3>
          <p>Return to the Members section of the website and log in using the credentials you created.</p>
          <p>If you experience any issues logging in, please contact us at <a href="mailto:${ADMIN_EMAIL}" style="color: #2d6a4f;">${ADMIN_EMAIL}</a> and we will get back to you right away.</p>
          <div style="margin: 20px 0; text-align: center;">
            <a href="${SITE_URL}/members.html" style="background: #2d6a4f; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; display: inline-block;">Log In Now</a>
          </div>

          <h3 style="font-size: 15px; margin-bottom: 4px;">2. Update Your My Household Profile</h3>
          <p>Once logged in, please complete your Household Profile by adding:</p>
          <ul style="line-height: 2;">
            <li>All members of your household</li>
            <li>Pets</li>
            <li>Social media links</li>
            <li>Family or household photos</li>
            <li>Privacy &amp; Publish preferences</li>
          </ul>

          <h3 style="font-size: 15px; margin-bottom: 4px;">3. Set Directory Preferences</h3>
          <p>If you would like your information visible in the community member directory, please set your preferences to <strong>Show</strong>.</p>

          <h3 style="font-size: 15px; margin-bottom: 4px;">4. Register Your Phone for Pool Access</h3>
          <p>Be sure to complete the <strong>Register Phone</strong> step. Your registered phone number will serve as your new pool gate entry access.</p>
          <p>Please also add all household members who will need access to the pool.</p>

          <p style="margin-top: 28px;">We are excited to have you as part of the Glenridge Community and look forward to helping you stay connected.</p>
          <p>Warm regards,<br>
          <strong>${BRAND_SHORT} Administration</strong><br>
          <a href="mailto:${ADMIN_EMAIL}" style="color: #2d6a4f;">${ADMIN_EMAIL}</a></p>
        </div>
        <div style="padding: 16px; text-align: center; color: #888; font-size: 13px;">
          ${BRAND_NAME} &bull; ${BRAND_LOCATION}
        </div>
      </div>
      `
    );

    res.json({ success: true, message: `${user.first_name} ${user.last_name} has been approved and notified via email.` });

  } catch (err) {
    console.error('Approve error:', err);
    res.status(500).json({ error: 'An error occurred while approving the user.' });
  }
});

// Deny user
app.post('/api/admin/users/:id/deny', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [id]);

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await dbRun(`UPDATE users SET status = 'denied' WHERE id = ?`, [id]);

    // Send denial email
    await sendEmail(
      user.email,
      'Glenridge Community — Account Update',
      `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #2d6a4f; color: white; padding: 24px; border-radius: 12px 12px 0 0;">
          <h1 style="margin: 0; font-size: 20px;">Account Update</h1>
        </div>
        <div style="background: #f8f9fa; padding: 24px; border: 1px solid #e0e0e0;">
          <p>Hello ${user.first_name},</p>
          <p>We were unable to verify your residency in the ${BRAND_SHORT} at this time. If you believe this is an error, please contact us at <a href="mailto:${ADMIN_EMAIL}">${ADMIN_EMAIL}</a> with your address and proof of residency.</p>
        </div>
        <div style="padding: 16px; text-align: center; color: #888; font-size: 13px;">
          ${BRAND_NAME} &bull; ${BRAND_LOCATION}
        </div>
      </div>
      `
    );

    res.json({ success: true, message: `${user.first_name} ${user.last_name} has been denied.` });

  } catch (err) {
    console.error('Deny error:', err);
    res.status(500).json({ error: 'An error occurred.' });
  }
});

// Delete user
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  await dbRun('DELETE FROM users WHERE id = ?', [id]);
  res.json({ success: true });
});

// ── Newsletter Routes ────────────────────────────────────

const nlImgDir = path.join(__dirname, 'images', 'newsletter');
if (!fs.existsSync(nlImgDir)) fs.mkdirSync(nlImgDir, { recursive: true });

const nlUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, nlImgDir),
    filename:    (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /jpeg|jpg|png|webp|gif/.test(file.mimetype);
    cb(ok ? null : new Error('Image files only'), ok);
  }
});

async function syncSubscribers() {
  const approved = await dbAll(`SELECT id, first_name, last_name, email FROM users WHERE status='approved'`);
  for (const u of approved) {
    const existing = await dbGet(`SELECT id FROM nl_subscribers WHERE email=?`, [u.email]);
    if (!existing) {
      await dbRun(`INSERT INTO nl_subscribers (id, email, first_name, last_name, unsubscribe_token, source)
             VALUES (?,?,?,?,?,'member')`,
            [uuidv4(), u.email, u.first_name, u.last_name, uuidv4()]);
    }
  }
}

function siteUrl() { return SITE_URL; }

function buildSendHtml(htmlContent, sendLogId, unsubToken) {
  const base = siteUrl();
  let html = htmlContent.replace(/href="(https?:\/\/[^"]+)"/g, (match, url) => {
    if (url.includes('/api/nl/track/') || url.includes('/unsubscribe')) return match;
    return `href="${base}/api/nl/track/click/${sendLogId}/${unsubToken}?url=${encodeURIComponent(url)}"`;
  });
  const pixel = `<img src="${base}/api/nl/track/open/${sendLogId}/${unsubToken}" width="1" height="1" alt="" style="display:none;">`;
  return html.replace('</body>', pixel + '</body>');
}

app.get('/api/nl/newsletters', requireAdmin, async (req, res) => {
  const rows = await dbAll(`SELECT id,subject,status,sent_at,recipient_count,created_at,updated_at FROM nl_newsletters ORDER BY created_at DESC`);
  res.json(rows);
});

app.get('/api/nl/newsletters/:id', requireAdmin, async (req, res) => {
  const row = await dbGet(`SELECT * FROM nl_newsletters WHERE id=?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

app.post('/api/nl/newsletters', requireAdmin, async (req, res) => {
  const { subject, preview_text, html_content, blocks_json } = req.body;
  if (!subject) return res.status(400).json({ error: 'Subject required' });
  const id = uuidv4();
  await dbRun(`INSERT INTO nl_newsletters (id,subject,preview_text,html_content,blocks_json,created_by) VALUES (?,?,?,?,?,?)`,
        [id, subject, preview_text||'', html_content||'', blocks_json||'[]', 'admin']);
  res.json({ success: true, id });
});

app.put('/api/nl/newsletters/:id', requireAdmin, async (req, res) => {
  const { subject, preview_text, html_content, blocks_json } = req.body;
  const nl = await dbGet(`SELECT id,status FROM nl_newsletters WHERE id=?`, [req.params.id]);
  if (!nl) return res.status(404).json({ error: 'Not found' });
  if (nl.status === 'sent') return res.status(400).json({ error: 'Cannot edit sent newsletter' });
  await dbRun(`UPDATE nl_newsletters SET subject=?,preview_text=?,html_content=?,blocks_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [subject, preview_text||'', html_content||'', blocks_json||'[]', req.params.id]);
  res.json({ success: true });
});

app.delete('/api/nl/newsletters/:id', requireAdmin, async (req, res) => {
  await dbRun(`DELETE FROM nl_newsletters WHERE id=?`, [req.params.id]);
  res.json({ success: true });
});

app.post('/api/nl/images', requireAdmin, nlUpload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: `/images/newsletter/${req.file.filename}` });
});

app.post('/api/nl/newsletters/:id/test', requireAdmin, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const nl = await dbGet(`SELECT * FROM nl_newsletters WHERE id=?`, [req.params.id]);
  if (!nl) return res.status(404).json({ error: 'Not found' });
  const html = nl.html_content.replace(/\{\{UNSUBSCRIBE_URL\}\}/g,'#').replace(/\{\{FIRST_NAME\}\}/g,'Neighbor');
  try {
    await transporter.sendMail({
      from: `"${BRAND_NAME}" <${MAIL_FROM_EMAIL}>`,
      to: email, subject: `[TEST] ${nl.subject}`, html
    });
    res.json({ success: true });
  } catch {
    console.log(`[Newsletter Test] Would send to ${email}: ${nl.subject}`);
    res.json({ success: true, note: 'SMTP not configured — logged to console' });
  }
});

app.post('/api/nl/newsletters/:id/send', requireAdmin, async (req, res) => {
  const nl = await dbGet(`SELECT * FROM nl_newsletters WHERE id=?`, [req.params.id]);
  if (!nl) return res.status(404).json({ error: 'Not found' });
  if (nl.status === 'sent') return res.status(400).json({ error: 'Already sent' });
  await syncSubscribers();
  const subscribers = await dbAll(`SELECT * FROM nl_subscribers WHERE status='active'`);
  if (!subscribers.length) return res.status(400).json({ error: 'No active subscribers' });
  await dbRun(`UPDATE nl_newsletters SET status='sent',sent_at=CURRENT_TIMESTAMP,recipient_count=? WHERE id=?`,
        [subscribers.length, nl.id]);
  let sent = 0;
  for (const sub of subscribers) {
    const sendId = uuidv4();
    await dbRun(`INSERT INTO nl_send_log (id,newsletter_id,subscriber_id) VALUES (?,?,?)`, [sendId, nl.id, sub.id]);
    const unsubUrl = `${siteUrl()}/unsubscribe.html?token=${sub.unsubscribe_token}`;
    const html = buildSendHtml(
      nl.html_content.replace(/\{\{UNSUBSCRIBE_URL\}\}/g, unsubUrl).replace(/\{\{FIRST_NAME\}\}/g, sub.first_name||'Neighbor'),
      sendId, sub.unsubscribe_token
    );
    try {
      await transporter.sendMail({
        from: `"${BRAND_NAME}" <${MAIL_FROM_EMAIL}>`,
        to: sub.email, subject: nl.subject, html,
        headers: { 'List-Unsubscribe': `<${unsubUrl}>` }
      });
    } catch {
      console.log(`[Newsletter] Would send to ${sub.email}: ${nl.subject}`);
    }
    sent++;
  }
  res.json({ success: true, sent });
});

app.get('/api/nl/newsletters/:id/analytics', requireAdmin, async (req, res) => {
  const nl = await dbGet(`SELECT id,subject,sent_at,recipient_count,status FROM nl_newsletters WHERE id=?`, [req.params.id]);
  if (!nl) return res.status(404).json({ error: 'Not found' });
  const logs   = await dbAll(`SELECT id FROM nl_send_log WHERE newsletter_id=?`, [nl.id]);
  const logIds = logs.map(l => l.id);
  let opens=0,uniqueOpens=0,clicks=0,uniqueClicks=0;
  const clickMap = {};
  if (logIds.length) {
    const ph = logIds.map(()=>'?').join(',');
    const eng = await dbAll(`SELECT send_log_id,event_type,url FROM nl_engagement WHERE send_log_id IN (${ph})`, logIds);
    const openSet=new Set(), clickSet=new Set();
    eng.forEach(e => {
      if (e.event_type==='open')  { opens++;  openSet.add(e.send_log_id); }
      if (e.event_type==='click') { clicks++; clickSet.add(e.send_log_id); if(e.url) clickMap[e.url]=(clickMap[e.url]||0)+1; }
    });
    uniqueOpens=openSet.size; uniqueClicks=clickSet.size;
  }
  const delivered = nl.recipient_count||0;
  res.json({
    newsletter: nl, delivered,
    opens, uniqueOpens, clicks, uniqueClicks,
    openRate:  delivered ? ((uniqueOpens/delivered)*100).toFixed(1):'0.0',
    clickRate: delivered ? ((uniqueClicks/delivered)*100).toFixed(1):'0.0',
    topLinks: Object.entries(clickMap).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([url,count])=>({url,count}))
  });
});

app.get('/api/nl/subscribers', requireAdmin, async (req, res) => {
  await syncSubscribers();
  res.json(await dbAll(`SELECT id,email,first_name,last_name,status,subscribed_at,unsubscribed_at,source FROM nl_subscribers ORDER BY subscribed_at DESC`));
});

app.post('/api/nl/subscribers', requireAdmin, async (req, res) => {
  const { email, first_name, last_name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (await dbGet(`SELECT id FROM nl_subscribers WHERE email=?`, [email])) return res.status(409).json({ error: 'Already subscribed' });
  await dbRun(`INSERT INTO nl_subscribers (id,email,first_name,last_name,unsubscribe_token,source) VALUES (?,?,?,?,'manual')`,
        [uuidv4(), email, first_name||'', last_name||'', uuidv4()]);
  res.json({ success: true });
});

app.delete('/api/nl/subscribers/:id', requireAdmin, async (req, res) => {
  await dbRun(`UPDATE nl_subscribers SET status='unsubscribed',unsubscribed_at=CURRENT_TIMESTAMP WHERE id=?`, [req.params.id]);
  res.json({ success: true });
});

app.get('/api/nl/track/open/:sendLogId/:token', async (req, res) => {
  const { sendLogId, token } = req.params;
  const sub = await dbGet(`SELECT id FROM nl_subscribers WHERE unsubscribe_token=?`, [token]);
  const log = await dbGet(`SELECT id FROM nl_send_log WHERE id=?`, [sendLogId]);
  if (sub && log) await dbRun(`INSERT INTO nl_engagement (id,send_log_id,event_type) VALUES (?,?,'open')`, [uuidv4(), sendLogId]);
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
  res.writeHead(200,{'Content-Type':'image/gif','Content-Length':gif.length,'Cache-Control':'no-store','Pragma':'no-cache'});
  res.end(gif);
});

app.get('/api/nl/track/click/:sendLogId/:token', async (req, res) => {
  const { sendLogId, token } = req.params;
  const url = req.query.url||'/';
  const sub = await dbGet(`SELECT id FROM nl_subscribers WHERE unsubscribe_token=?`, [token]);
  const log = await dbGet(`SELECT id FROM nl_send_log WHERE id=?`, [sendLogId]);
  if (sub && log) await dbRun(`INSERT INTO nl_engagement (id,send_log_id,event_type,url) VALUES (?,?,'click',?)`, [uuidv4(), sendLogId, url]);
  res.redirect(url);
});

app.get('/api/nl/unsubscribe', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Missing token' });
  const sub = await dbGet(`SELECT id,status FROM nl_subscribers WHERE unsubscribe_token=?`, [token]);
  if (!sub) return res.status(404).json({ error: 'Invalid token' });
  if (sub.status !== 'unsubscribed')
    await dbRun(`UPDATE nl_subscribers SET status='unsubscribed',unsubscribed_at=CURRENT_TIMESTAMP WHERE id=?`, [sub.id]);
  res.json({ success: true });
});

// ── Pool Management Routes ───────────────────────────────

// Sync approved members + family into pool_members as Residents
app.post('/api/admin/pool/sync-residents', requireAdmin, async (req, res) => {
  try {
    const residentType = await dbGet("SELECT id FROM pool_entry_types WHERE name='Resident'");
    if (!residentType) return res.status(500).json({ error: 'Resident entry type not found.' });

    const approvedUsers = await dbAll("SELECT id, first_name, last_name FROM users WHERE status='approved'");
    let added = 0;

    for (const user of approvedUsers) {
      // Add the member themselves
      const existing = await dbGet('SELECT id FROM pool_members WHERE user_id = ? AND source = ?', [user.id, 'member']);
      if (!existing) {
        await dbRun(`INSERT INTO pool_members (id, first_name, last_name, entry_type_id, user_id, source)
               VALUES (?, ?, ?, ?, ?, 'member')`,
          [uuidv4(), user.first_name, user.last_name, residentType.id, user.id]);
        added++;
      }

      // Add directory adults (family members)
      const adults = await dbAll('SELECT id, name FROM dir_adults WHERE user_id = ?', [user.id]);
      for (const adult of adults) {
        const existingAdult = await dbGet('SELECT id FROM pool_members WHERE user_id = ? AND source = ?',
          [`family_adult_${adult.id}`, 'family']);
        if (!existingAdult) {
          const parts = adult.name.split(' ');
          const firstName = parts[0] || adult.name;
          const lastName = parts.slice(1).join(' ') || user.last_name;
          await dbRun(`INSERT INTO pool_members (id, first_name, last_name, entry_type_id, user_id, source)
                 VALUES (?, ?, ?, ?, ?, 'family')`,
            [uuidv4(), firstName, lastName, residentType.id, `family_adult_${adult.id}`]);
          added++;
        }
      }

      // Add directory children
      const children = await dbAll('SELECT id, first_name FROM dir_children WHERE user_id = ?', [user.id]);
      for (const child of children) {
        const existingChild = await dbGet('SELECT id FROM pool_members WHERE user_id = ? AND source = ?',
          [`family_child_${child.id}`, 'family']);
        if (!existingChild) {
          await dbRun(`INSERT INTO pool_members (id, first_name, last_name, entry_type_id, user_id, source)
                 VALUES (?, ?, ?, ?, ?, 'family')`,
            [uuidv4(), child.first_name, user.last_name, residentType.id, `family_child_${child.id}`]);
          added++;
        }
      }
    }

    res.json({ success: true, added, message: `Synced residents. ${added} new pool member(s) added.` });
  } catch (err) {
    console.error('Pool sync error:', err);
    res.status(500).json({ error: 'Failed to sync residents.' });
  }
});

// POST /api/admin/pool/cleanup-orphans — remove Resident pool_members that
// have no household (owning dir_adult/dir_child deleted, or owning user
// removed). Callable on demand from the admin UI.
app.post('/api/admin/pool/cleanup-orphans', requireAdmin, async (req, res) => {
  try {
    const removed = await cleanupOrphanedResidentPoolMembers();
    res.json({ success: true, removed,
      message: removed > 0
        ? `Removed ${removed} orphaned Resident(s) with no household address.`
        : 'No orphaned Residents found.' });
  } catch (err) {
    console.error('Pool orphan cleanup error:', err);
    res.status(500).json({ error: 'Failed to clean up orphaned residents.' });
  }
});

// GET entry types
app.get('/api/admin/pool/entry-types', requireAdmin, async (req, res) => {
  const types = await dbAll('SELECT * FROM pool_entry_types ORDER BY is_system DESC, name ASC');
  res.json(types);
});

// POST new entry type
app.post('/api/admin/pool/entry-types', requireAdmin, async (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
  const existing = await dbGet('SELECT id FROM pool_entry_types WHERE name = ?', [name.trim()]);
  if (existing) return res.status(409).json({ error: 'An entry type with this name already exists.' });
  const id = uuidv4();
  await dbRun('INSERT INTO pool_entry_types (id, name, description) VALUES (?, ?, ?)',
    [id, name.trim(), description?.trim() || null]);
  res.json({ success: true, id });
});

// DELETE entry type (not system ones)
app.delete('/api/admin/pool/entry-types/:id', requireAdmin, async (req, res) => {
  const type = await dbGet('SELECT * FROM pool_entry_types WHERE id = ?', [req.params.id]);
  if (!type) return res.status(404).json({ error: 'Entry type not found.' });
  if (type.is_system) return res.status(400).json({ error: 'Cannot delete a system entry type.' });
  const memberCount = await dbGet('SELECT COUNT(*) as c FROM pool_members WHERE entry_type_id = ?', [req.params.id]);
  if (memberCount && memberCount.c > 0) return res.status(400).json({ error: 'Cannot delete — there are pool members using this entry type.' });
  await dbRun('DELETE FROM pool_schedules WHERE entry_type_id = ?', [req.params.id]);
  await dbRun('DELETE FROM pool_entry_types WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// GET pool members
app.get('/api/admin/pool/members', requireAdmin, async (req, res) => {
  const members = await dbAll(`
    SELECT pm.*, pet.name as entry_type_name
    FROM pool_members pm
    JOIN pool_entry_types pet ON pm.entry_type_id = pet.id
    ORDER BY pet.name, pm.last_name, pm.first_name
  `);
  const enriched = await Promise.all(members.map(async m => {
    const household = await getPoolMemberHousehold(m);
    const street_address = household ? household.streetAddress : null;
    const household_owner_user_id = household ? household.ownerUserId : null;
    const household_owner_name = household
      ? `${household.ownerFirstName} ${household.ownerLastName}`.trim()
      : null;

    // Determine phone preference and child-age status via notes linkage
    let device_platform = null;
    let is_child_under_16 = false;

    if (typeof m.notes === 'string') {
      const adultMatch = m.notes.match(/^family_adult_(.+)$/);
      const childMatch = m.notes.match(/^family_child_(.+)$/);
      if (adultMatch) {
        const ph = await dbGet(
          `SELECT device_platform FROM dir_pool_phones
           WHERE person_type='adult' AND person_id=? AND status='active'
           ORDER BY created_at DESC LIMIT 1`,
          [adultMatch[1]]);
        if (ph) device_platform = ph.device_platform;
      } else if (childMatch) {
        const child = await dbGet('SELECT is_16_plus FROM dir_children WHERE id=?', [childMatch[1]]);
        if (child && !child.is_16_plus) is_child_under_16 = true;
        if (!is_child_under_16) {
          const ph = await dbGet(
            `SELECT device_platform FROM dir_pool_phones
             WHERE person_type='child' AND person_id=? AND status='active'
             ORDER BY created_at DESC LIMIT 1`,
            [childMatch[1]]);
          if (ph) device_platform = ph.device_platform;
        }
      }
    }
    if (!device_platform && !is_child_under_16 && m.user_id) {
      const ph = await dbGet(
        `SELECT device_platform FROM dir_pool_phones
         WHERE user_id=? AND person_type='self' AND status='active'
         ORDER BY created_at DESC LIMIT 1`,
        [m.user_id]);
      if (ph) device_platform = ph.device_platform;
    }

    return {
      ...m,
      street_address,
      household_key: street_address ? street_address.toLowerCase() : null,
      household_owner_user_id,
      household_owner_name,
      device_platform,
      is_child_under_16
    };
  }));
  res.json(enriched);
});

// POST new pool member (manual — for non-residents)
app.post('/api/admin/pool/members', requireAdmin, async (req, res) => {
  const { first_name, last_name, entry_type_id, notes, rfid_tag } = req.body;
  if (!first_name || !last_name || !entry_type_id) {
    return res.status(400).json({ error: 'First name, last name, and entry type are required.' });
  }
  const type = await dbGet('SELECT id FROM pool_entry_types WHERE id = ?', [entry_type_id]);
  if (!type) return res.status(400).json({ error: 'Invalid entry type.' });
  const hasRfidColumn = await poolMembersHasRfidTagColumn();
  const normalizedRfid = rfid_tag ? normalizeRfidCredentialValue(rfid_tag) : null;
  if (hasRfidColumn && normalizedRfid) {
    const existingLegacy = await dbGet('SELECT id FROM pool_members WHERE rfid_tag = ?', [normalizedRfid]);
    if (existingLegacy) return res.status(400).json({ error: 'This RFID tag is already assigned to another member.' });
    const existingCredential = await dbGet('SELECT pool_member_id, status FROM pool_nfc_credentials WHERE credential_hash = ?', [hashPoolCredential('rfid', normalizedRfid)]);
    if (existingCredential && existingCredential.status === 'active') {
      return res.status(400).json({ error: 'This RFID tag is already assigned to another member.' });
    }
  }
  const id = uuidv4();
  if (hasRfidColumn) {
    await dbRun(`INSERT INTO pool_members (id, first_name, last_name, entry_type_id, source, notes, rfid_tag)
           VALUES (?, ?, ?, ?, 'manual', ?, ?)`,
      [id, first_name.trim(), last_name.trim(), entry_type_id, notes?.trim() || null, normalizedRfid || null]);
  } else {
    await dbRun(`INSERT INTO pool_members (id, first_name, last_name, entry_type_id, source, notes)
           VALUES (?, ?, ?, ?, 'manual', ?)`,
      [id, first_name.trim(), last_name.trim(), entry_type_id, notes?.trim() || null]);
  }

  if (normalizedRfid) {
    const assigned = await upsertRfidCredentialForMember(id, normalizedRfid, `${first_name.trim()} ${last_name.trim()}'s card`);
    if (!assigned.ok) return res.status(400).json({ error: assigned.error });
  }

  res.json({ success: true, id });
});

// PUT update pool member
app.put('/api/admin/pool/members/:id', requireAdmin, async (req, res) => {
  const member = await dbGet('SELECT * FROM pool_members WHERE id = ?', [req.params.id]);
  if (!member) return res.status(404).json({ error: 'Pool member not found.' });
  const { first_name, last_name, entry_type_id, status, notes, rfid_tag } = req.body;
  const hasRfidColumn = await poolMembersHasRfidTagColumn();

  if (hasRfidColumn && rfid_tag !== undefined) {
    const normalizedRfid = normalizeRfidCredentialValue(rfid_tag);
    if (normalizedRfid) {
      const existing = await dbGet('SELECT id FROM pool_members WHERE rfid_tag = ? AND id != ?', [normalizedRfid, req.params.id]);
      if (existing) return res.status(400).json({ error: 'This RFID tag is already assigned to another member.' });
      const existingCredential = await dbGet('SELECT pool_member_id, status FROM pool_nfc_credentials WHERE credential_hash = ?', [hashPoolCredential('rfid', normalizedRfid)]);
      if (existingCredential && existingCredential.status === 'active' && existingCredential.pool_member_id !== req.params.id) {
        return res.status(400).json({ error: 'This RFID tag is already assigned to another member.' });
      }
    }
  }

  if (hasRfidColumn) {
    const normalizedRfid = rfid_tag !== undefined ? normalizeRfidCredentialValue(rfid_tag) : (member.rfid_tag || null);
    await dbRun(`UPDATE pool_members SET first_name=?, last_name=?, entry_type_id=?, status=?, notes=?, rfid_tag=? WHERE id=?`,
      [first_name || member.first_name, last_name || member.last_name,
       entry_type_id || member.entry_type_id, status || member.status,
       notes !== undefined ? notes : member.notes,
       rfid_tag !== undefined ? (normalizedRfid || null) : (member.rfid_tag || null), req.params.id]);

    if (rfid_tag !== undefined && normalizedRfid) {
      const displayName = `${first_name || member.first_name} ${last_name || member.last_name}'s card`;
      const assigned = await upsertRfidCredentialForMember(req.params.id, normalizedRfid, displayName);
      if (!assigned.ok) return res.status(400).json({ error: assigned.error });
    }
  } else {
    await dbRun(`UPDATE pool_members SET first_name=?, last_name=?, entry_type_id=?, status=?, notes=? WHERE id=?`,
      [first_name || member.first_name, last_name || member.last_name,
       entry_type_id || member.entry_type_id, status || member.status,
       notes !== undefined ? notes : member.notes, req.params.id]);
  }

  res.json({ success: true });
});

// Add an additional RFID card credential to a pool member
app.post('/api/admin/pool/members/:id/credentials/rfid', requireAdmin, async (req, res) => {
  const member = await dbGet('SELECT * FROM pool_members WHERE id = ?', [req.params.id]);
  if (!member) return res.status(404).json({ error: 'Pool member not found.' });

  const rawTag = (req.body?.rfid_tag || '').trim();
  const deviceName = (req.body?.device_name || '').trim();
  if (!rawTag) return res.status(400).json({ error: 'RFID tag is required.' });

  const assigned = await upsertRfidCredentialForMember(req.params.id, rawTag, deviceName || `${member.first_name} ${member.last_name}'s card`);
  if (!assigned.ok) return res.status(400).json({ error: assigned.error });

  res.json({ success: true, credential_id: assigned.id, normalized_tag: assigned.normalized });
});

// DELETE pool member
app.delete('/api/admin/pool/members/:id', requireAdmin, async (req, res) => {
  await dbRun('DELETE FROM pool_schedules WHERE pool_member_id = ?', [req.params.id]);
  await dbRun('DELETE FROM pool_members WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ── Wallet Pass Requests ────────────────────────────

// GET /api/admin/pool/wallet-requests — list all active phone registrations
// with their wallet pass status so admin can see who needs a pass emailed.
app.get('/api/admin/pool/wallet-requests', requireAdmin, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT p.*, u.email AS user_email
       FROM dir_pool_phones p
       LEFT JOIN users u ON u.id = p.user_id
       WHERE p.status = 'active'
       ORDER BY p.wallet_pass_status ASC, p.created_at DESC`);
    res.json({ requests: rows.map(r => ({
      id: r.id,
      person_name: r.person_name,
      person_type: r.person_type,
      device_platform: r.device_platform,
      device_label: r.device_label,
      wallet_pass_status: r.wallet_pass_status || 'pending',
      user_email: r.user_email,
      created_at: r.created_at
    }))});
  } catch (err) {
    console.error('GET /api/admin/pool/wallet-requests error:', err.message);
    res.status(500).json({ error: 'Failed to load wallet requests.' });
  }
});

// POST /api/admin/pool/wallet-requests/:id/mark-sent — mark a wallet pass
// request as sent (admin has emailed the pass to the member).
app.post('/api/admin/pool/wallet-requests/:id/mark-sent', requireAdmin, async (req, res) => {
  try {
    const row = await dbGet('SELECT * FROM dir_pool_phones WHERE id=?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Phone registration not found.' });
    await dbRun(
      `UPDATE dir_pool_phones SET wallet_pass_status='sent', updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/admin/pool/wallet-requests mark-sent error:', err.message);
    res.status(500).json({ error: 'Failed to update wallet request.' });
  }
});

// ── Apple Wallet Pass Generation ────────────────────

// Generate Apple Wallet pass (.pkpass) for a pool member
app.post('/api/admin/pool/members/:id/generate-apple-pass', requireAdmin, async (req, res) => {
  const member = await dbGet('SELECT * FROM pool_members WHERE id = ?', [req.params.id]);
  if (!member) return res.status(404).json({ error: 'Pool member not found.' });

  try {
    // Always generate a fresh credential for each new pass
    const credentialToken = crypto.randomBytes(32).toString('hex');
    const credentialHash = crypto.createHash('sha256').update(credentialToken).digest('hex');
    const passSerial = uuidv4();

    await dbRun(`
      INSERT INTO pool_nfc_credentials (id, pool_member_id, credential_hash, device_platform, device_name, pass_serial, pass_generated_at)
      VALUES (?, ?, ?, 'ios', ?, ?, CURRENT_TIMESTAMP)
    `, [uuidv4(), member.id, credentialHash, `${member.first_name} ${member.last_name}'s iPhone`, passSerial]);

    // Build pass.json
    const passJson = {
      formatVersion: 1,
      passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID || 'pass.glenridge.pool',
      serialNumber: passSerial,
      teamIdentifier: process.env.APPLE_TEAM_ID || 'ABCDEFGHIJ',
      organizationName: 'Glenridge HOA',
      description: 'Glenridge Pool Access Pass',
      logoText: 'Glenridge HOA',
      foregroundColor: 'rgb(255, 255, 255)',
      backgroundColor: 'rgb(30, 126, 116)',
      generic: {
        primaryFields: [{ key: 'member', label: 'MEMBER', value: `${member.first_name} ${member.last_name}` }],
        secondaryFields: [{ key: 'access', label: 'ACCESS', value: 'Pool Entry' }],
        auxiliaryFields: [{ key: 'serial', label: 'PASS ID', value: passSerial.substring(0, 8).toUpperCase() }]
      }
    };

    // Add NFC if env key is set (requires Apple entitlement in production)
    if (process.env.APPLE_NFC_PUBKEY) {
      passJson.nfc = { message: credentialHash, encryptionPublicKey: process.env.APPLE_NFC_PUBKEY };
    }

    // Generate small PNG icons (29x29 and 58x58) using pure Node.js
    const icon1x = makeSolidPng(29, 29, 30, 126, 116);
    const icon2x = makeSolidPng(58, 58, 30, 126, 116);

    // Build manifest (SHA1 of each file)
    const passJsonBuf = Buffer.from(JSON.stringify(passJson), 'utf8');
    const manifest = {
      'pass.json': crypto.createHash('sha1').update(passJsonBuf).digest('hex'),
      'icon.png': crypto.createHash('sha1').update(icon1x).digest('hex'),
      'icon@2x.png': crypto.createHash('sha1').update(icon2x).digest('hex')
    };
    const manifestBuf = Buffer.from(JSON.stringify(manifest), 'utf8');

    // Signature is required by Apple Wallet; without a real cert the file
    // will open on device but show an "Invalid Pass" warning.
    // Use APPLE_CERT_PATH + APPLE_KEY_PATH env vars to enable signing.
    let signatureBuf = Buffer.alloc(0);
    if (process.env.APPLE_CERT_PATH && process.env.APPLE_KEY_PATH) {
      try {
        const certPem = fs.readFileSync(process.env.APPLE_CERT_PATH);
        const keyPem = fs.readFileSync(process.env.APPLE_KEY_PATH);
        const wwdrPem = process.env.APPLE_WWDR_PATH ? fs.readFileSync(process.env.APPLE_WWDR_PATH) : null;
        // Use openssl via child_process for PKCS7 signing
        const { execSync } = require('child_process');
        const tmpDir = require('os').tmpdir();
        const mPath = path.join(tmpDir, `manifest_${passSerial}.json`);
        const sPath = path.join(tmpDir, `sig_${passSerial}.der`);
        fs.writeFileSync(mPath, manifestBuf);
        const wwdrArg = wwdrPem ? `-certfile ${process.env.APPLE_WWDR_PATH}` : '';
        execSync(`openssl smime -binary -sign -certfile ${process.env.APPLE_CERT_PATH} -signer ${process.env.APPLE_CERT_PATH} -inkey ${process.env.APPLE_KEY_PATH} ${wwdrArg} -in ${mPath} -out ${sPath} -outform DER`);
        signatureBuf = fs.readFileSync(sPath);
        fs.unlinkSync(mPath); fs.unlinkSync(sPath);
      } catch (sigErr) {
        console.warn('Pass signing failed (pass will be unsigned):', sigErr.message);
      }
    }

    // Build .pkpass ZIP
    const zip = new JSZip();
    zip.file('pass.json', passJsonBuf);
    zip.file('manifest.json', manifestBuf);
    zip.file('signature', signatureBuf);
    zip.file('icon.png', icon1x);
    zip.file('icon@2x.png', icon2x);

    const pkpassBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', `attachment; filename="${member.first_name}_${member.last_name}_pool_pass.pkpass"`);
    res.send(pkpassBuffer);

    console.log(`✓ Generated Apple Wallet pass for ${member.first_name} ${member.last_name} (serial: ${passSerial})`);

  } catch (err) {
    console.error('Apple Wallet pass generation error:', err);
    res.status(500).json({ error: 'Failed to generate Apple Wallet pass.', details: err.message });
  }
});

// Generate Google Wallet pass (JWT save link) for a pool member
app.post('/api/admin/pool/members/:id/generate-google-pass', requireAdmin, async (req, res) => {
  const member = await dbGet('SELECT * FROM pool_members WHERE id = ?', [req.params.id]);
  if (!member) return res.status(404).json({ error: 'Pool member not found.' });

  const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID;
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY; // PEM private key, newlines as \n

  if (!issuerId || !serviceAccountEmail || !serviceAccountKey) {
    return res.status(503).json({
      error: 'Google Wallet not configured.',
      setup: 'Set GOOGLE_WALLET_ISSUER_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, and GOOGLE_SERVICE_ACCOUNT_KEY in .env'
    });
  }

  try {
    const jwt = require('jsonwebtoken');
    const credentialToken = crypto.randomBytes(32).toString('hex');
    const credentialHash = crypto.createHash('sha256').update(credentialToken).digest('hex');
    const passSerial = uuidv4();
    const objectId = `${issuerId}.pool_${passSerial.replace(/-/g, '_')}`;
    const classId = `${issuerId}.glenridge_pool_access`;

    // Store credential
    await dbRun(`
      INSERT INTO pool_nfc_credentials (id, pool_member_id, credential_hash, device_platform, device_name, pass_serial, pass_generated_at)
      VALUES (?, ?, ?, 'android', ?, ?, CURRENT_TIMESTAMP)
    `, [uuidv4(), member.id, credentialHash, `${member.first_name} ${member.last_name}'s Android`, passSerial]);

    const genericObject = {
      id: objectId,
      classId: classId,
      genericType: 'GENERIC_TYPE_UNSPECIFIED',
      hexBackgroundColor: '#1e7e74',
      logo: {
        sourceUri: { uri: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Pool_icon.svg/120px-Pool_icon.svg.png' },
        contentDescription: { defaultValue: { language: 'en-US', value: 'Pool' } }
      },
      cardTitle: { defaultValue: { language: 'en-US', value: 'Glenridge HOA' } },
      subheader: { defaultValue: { language: 'en-US', value: 'Pool Access' } },
      header: { defaultValue: { language: 'en-US', value: `${member.first_name} ${member.last_name}` } },
      textModulesData: [
        { id: 'access', header: 'ACCESS LEVEL', body: 'Pool Entry' },
        { id: 'passid', header: 'PASS ID', body: passSerial.substring(0, 8).toUpperCase() }
      ],
      barcode: {
        type: 'QR_CODE',
        value: credentialHash,
        alternateText: 'Pool Access'
      },
      state: 'ACTIVE'
    };

    const claims = {
      iss: serviceAccountEmail,
      aud: 'google',
      origins: ['*'],
      typ: 'savetowallet',
      payload: { genericObjects: [genericObject] }
    };

    const privateKey = serviceAccountKey.replace(/\\n/g, '\n');
    const token = jwt.sign(claims, privateKey, { algorithm: 'RS256' });
    const saveUrl = `https://pay.google.com/gp/v/save/${token}`;

    res.json({ saveUrl, passSerial });
    console.log(`✓ Generated Google Wallet pass for ${member.first_name} ${member.last_name} (serial: ${passSerial})`);

  } catch (err) {
    console.error('Google Wallet pass generation error:', err);
    res.status(500).json({ error: 'Failed to generate Google Wallet pass.', details: err.message });
  }
});

// GET NFC credentials for a member
app.get('/api/admin/pool/members/:id/credentials', requireAdmin, async (req, res) => {
  const member = await dbGet('SELECT * FROM pool_members WHERE id = ?', [req.params.id]);
  if (!member) return res.status(404).json({ error: 'Pool member not found.' });

  // Backfill the legacy single RFID field into the credentials table so
  // gate sync and admin credential management stay consistent.
  if (await poolMembersHasRfidTagColumn() && member.rfid_tag) {
    await upsertRfidCredentialForMember(member.id, member.rfid_tag, `${member.first_name} ${member.last_name}'s card`);
  }

  const credentials = await dbAll(`
    SELECT id, credential_type, credential_hash, device_platform, device_name,
           pass_serial, pass_generated_at, created_at, status, revoked_at
    FROM pool_nfc_credentials
    WHERE pool_member_id = ?
    ORDER BY created_at DESC
  `, [req.params.id]);
  res.json(credentials);
});

// Revoke NFC credential
app.post('/api/admin/pool/members/:id/credentials/:credId/revoke', requireAdmin, async (req, res) => {
  const cred = await dbGet('SELECT * FROM pool_nfc_credentials WHERE id = ? AND pool_member_id = ?', [req.params.credId, req.params.id]);
  if (!cred) return res.status(404).json({ error: 'Credential not found.' });
  
  await dbRun('UPDATE pool_nfc_credentials SET status = ?, revoked_at = CURRENT_TIMESTAMP WHERE id = ?', ['revoked', req.params.credId]);
  res.json({ success: true, message: 'Credential revoked.' });
});

// GET schedules
app.get('/api/admin/pool/schedules', requireAdmin, async (req, res) => {
  const schedules = await dbAll(`
    SELECT ps.*,
           pet.name as entry_type_name,
           pm.first_name as member_first_name,
           pm.last_name as member_last_name
    FROM pool_schedules ps
    LEFT JOIN pool_entry_types pet ON ps.entry_type_id = pet.id
    LEFT JOIN pool_members pm ON ps.pool_member_id = pm.id
    ORDER BY ps.created_at DESC
  `);
  res.json(schedules);
});

// POST new schedule
app.post('/api/admin/pool/schedules', requireAdmin, async (req, res) => {
  const { name, entry_type_id, pool_member_id, schedule_type, days_of_week, start_time, end_time, specific_date, start_date, end_date } = req.body;
  if (!name || !schedule_type) {
    return res.status(400).json({ error: 'Name and schedule type are required.' });
  }
  if (!entry_type_id && !pool_member_id) {
    return res.status(400).json({ error: 'Must assign to an entry type or a specific member.' });
  }
  if (schedule_type === 'recurring') {
    if (!days_of_week || !start_time || !end_time) {
      return res.status(400).json({ error: 'Recurring schedules need days, start time, and end time.' });
    }
  }
  if (schedule_type === 'one_time') {
    if (!specific_date || !start_time || !end_time) {
      return res.status(400).json({ error: 'One-time schedules need a date, start time, and end time.' });
    }
  }
  if (schedule_type === 'holiday') {
    if (!specific_date || !start_time || !end_time) {
      return res.status(400).json({ error: 'Holiday schedules need a date, start time, and end time.' });
    }
  }
  const id = uuidv4();
  await dbRun(`INSERT INTO pool_schedules (id, name, entry_type_id, pool_member_id, schedule_type, days_of_week, start_time, end_time, specific_date, start_date, end_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name.trim(), entry_type_id || null, pool_member_id || null, schedule_type,
     days_of_week || null, start_time || null, end_time || null,
     specific_date || null, start_date || null, end_date || null]);
  res.json({ success: true, id });
});

// PUT update schedule
app.put('/api/admin/pool/schedules/:id', requireAdmin, async (req, res) => {
  const sched = await dbGet('SELECT * FROM pool_schedules WHERE id = ?', [req.params.id]);
  if (!sched) return res.status(404).json({ error: 'Schedule not found.' });
  const { name, entry_type_id, pool_member_id, schedule_type, days_of_week, start_time, end_time, specific_date, start_date, end_date, is_active } = req.body;
  await dbRun(`UPDATE pool_schedules SET name=?, entry_type_id=?, pool_member_id=?, schedule_type=?, days_of_week=?, start_time=?, end_time=?, specific_date=?, start_date=?, end_date=?, is_active=? WHERE id=?`,
    [name || sched.name, entry_type_id !== undefined ? entry_type_id : sched.entry_type_id,
     pool_member_id !== undefined ? pool_member_id : sched.pool_member_id,
     schedule_type || sched.schedule_type, days_of_week !== undefined ? days_of_week : sched.days_of_week,
     start_time !== undefined ? start_time : sched.start_time, end_time !== undefined ? end_time : sched.end_time,
     specific_date !== undefined ? specific_date : sched.specific_date,
     start_date !== undefined ? start_date : sched.start_date, end_date !== undefined ? end_date : sched.end_date,
     is_active !== undefined ? is_active : sched.is_active, req.params.id]);
  res.json({ success: true });
});

// DELETE schedule
app.delete('/api/admin/pool/schedules/:id', requireAdmin, async (req, res) => {
  await dbRun('DELETE FROM pool_schedules WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// GET pool access check — who can enter now or at a given time
app.get('/api/admin/pool/access-check', requireAdmin, async (req, res) => {
  const checkDate = req.query.date || new Date().toISOString().split('T')[0];
  const checkTime = req.query.time || new Date().toTimeString().slice(0, 5);
  const dayOfWeek = new Date(checkDate + 'T12:00:00').getDay(); // 0=Sun..6=Sat
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dayName = dayNames[dayOfWeek];

  const members = await dbAll(`
    SELECT pm.*, pet.name as entry_type_name
    FROM pool_members pm
    JOIN pool_entry_types pet ON pm.entry_type_id = pet.id
    WHERE pm.status = 'active'
  `);

  const results = await Promise.all(members.map(async member => {
    // Find applicable schedules (by entry type or specific member)
    const schedules = await dbAll(`
      SELECT * FROM pool_schedules
      WHERE is_active = 1
        AND (entry_type_id = ? OR pool_member_id = ?)
        AND (start_date IS NULL OR start_date <= ?)
        AND (end_date IS NULL OR end_date >= ?)
    `, [member.entry_type_id, member.id, checkDate, checkDate]);

    let allowed = false;
    let reason = 'No schedule';

    // Check if a holiday schedule exists for this date — it overrides all others
    const holidaySchedules = schedules.filter(s => s.schedule_type === 'holiday' && s.specific_date === checkDate);
    if (holidaySchedules.length > 0) {
      for (const h of holidaySchedules) {
        if (checkTime >= h.start_time && checkTime <= h.end_time) {
          allowed = true;
          reason = h.name + ' (holiday)';
          break;
        }
      }
      if (!allowed) reason = 'Outside holiday hours';
      return { ...member, allowed, reason };
    }

    for (const s of schedules) {
      if (s.schedule_type === 'unlimited') {
        allowed = true;
        reason = s.name;
        break;
      }
      if (s.schedule_type === 'recurring' && s.days_of_week) {
        const days = s.days_of_week.split(',');
        if (days.includes(dayName) && checkTime >= s.start_time && checkTime <= s.end_time) {
          allowed = true;
          reason = s.name;
          break;
        }
      }
      if (s.schedule_type === 'one_time' && s.specific_date === checkDate) {
        if (checkTime >= s.start_time && checkTime <= s.end_time) {
          allowed = true;
          reason = s.name;
          break;
        }
      }
    }

    return { ...member, allowed, reason };
  }));

  res.json({ date: checkDate, time: checkTime, day: dayName, members: results });
});

// POST pool check-in (record attendance)
app.post('/api/admin/pool/checkin', requireAdmin, async (req, res) => {
  const { pool_member_id, status, is_holiday, notes } = req.body;
  if (!pool_member_id) return res.status(400).json({ error: 'Pool member is required.' });
  const member = await dbGet('SELECT * FROM pool_members WHERE id = ?', [pool_member_id]);
  if (!member) return res.status(404).json({ error: 'Pool member not found.' });
  const id = uuidv4();
  await dbRun(`INSERT INTO pool_checkins (id, pool_member_id, entry_type_id, status, is_holiday, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
    [id, pool_member_id, member.entry_type_id, status || 'allowed', is_holiday ? 1 : 0, notes || null]);
  res.json({ success: true, id });
});

// GET pool attendance stats
app.get('/api/admin/pool/stats', requireAdmin, async (req, res) => {
  const now = new Date();

  // Week boundaries: Sunday to Saturday
  const dayOfWeek = now.getDay(); // 0=Sun
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - dayOfWeek);
  weekStart.setHours(0, 0, 0, 0);
  const weekStartStr = weekStart.toISOString().replace('T', ' ').slice(0, 19);

  // Month boundaries
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthStartStr = monthStart.toISOString().replace('T', ' ').slice(0, 19);

  const weekAttendance = await dbGet(
    "SELECT COUNT(*) as c FROM pool_checkins WHERE status='allowed' AND check_in_time >= ?",
    [weekStartStr]
  );

  const monthAttendance = await dbGet(
    "SELECT COUNT(*) as c FROM pool_checkins WHERE status='allowed' AND check_in_time >= ?",
    [monthStartStr]
  );

  const holidayAttendance = await dbGet(
    "SELECT COUNT(*) as c FROM pool_checkins WHERE status='allowed' AND is_holiday = 1 AND check_in_time >= ?",
    [monthStartStr]
  );

  const accessDenied = await dbGet(
    "SELECT COUNT(*) as c FROM pool_checkins WHERE status='denied' AND check_in_time >= ?",
    [monthStartStr]
  );

  res.json({
    week_attendance: weekAttendance?.c || 0,
    month_attendance: monthAttendance?.c || 0,
    holiday_attendance: holidayAttendance?.c || 0,
    access_denied: accessDenied?.c || 0
  });
});

// GET pool trend — rolling 30-day daily entry counts
app.get('/api/admin/pool/trend', requireAdmin, async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - days + 1);
  start.setHours(0, 0, 0, 0);
  const startStr = start.toISOString().replace('T', ' ').slice(0, 19);

  // Get daily counts grouped by date
  const rows = await dbAll(`
    SELECT DATE(check_in_time) as date,
           SUM(CASE WHEN status='allowed' THEN 1 ELSE 0 END) as allowed,
           SUM(CASE WHEN status='denied' THEN 1 ELSE 0 END) as denied
    FROM pool_checkins
    WHERE check_in_time >= ?
    GROUP BY DATE(check_in_time)
    ORDER BY date
  `, [startStr]);

  // Build full date range with zeros for missing days
  const trend = [];
  const dateMap = {};
  for (const r of rows) {
    dateMap[r.date] = { allowed: r.allowed, denied: r.denied };
  }
  for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    trend.push({
      date: dateStr,
      allowed: dateMap[dateStr]?.allowed || 0,
      denied: dateMap[dateStr]?.denied || 0
    });
  }

  res.json(trend);
});

// GET pool check-in log
app.get('/api/admin/pool/checkins', requireAdmin, async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const rows = await dbAll(`
    SELECT pc.*, pm.first_name, pm.last_name, pet.name as entry_type_name
    FROM pool_checkins pc
    JOIN pool_members pm ON pc.pool_member_id = pm.id
    JOIN pool_entry_types pet ON pc.entry_type_id = pet.id
    ORDER BY pc.check_in_time DESC
    LIMIT ?
  `, [limit]);
  res.json(rows);
});

// ── Gate Sync API (for Raspberry Pi gate controller) ─────────────
const GATE_API_KEY = process.env.GATE_API_KEY || 'change-this-gate-api-key';

function requireGateKey(req, res, next) {
  const key = req.headers['x-gate-api-key'];
  if (key && key === GATE_API_KEY) return next();
  return res.status(403).json({ error: 'Invalid gate API key.' });
}

// Pull full pool data snapshot for local DB sync
app.get('/api/gate/sync/pull', requireGateKey, async (req, res) => {
  const since = req.query.since; // ISO timestamp — return only changes after this time (optional)
  
  const entry_types = await dbAll('SELECT * FROM pool_entry_types');
  
  let members, schedules;
  if (since) {
    members = await dbAll('SELECT * FROM pool_members');
    schedules = await dbAll('SELECT * FROM pool_schedules');
  } else {
    members = await dbAll('SELECT * FROM pool_members');
    schedules = await dbAll('SELECT * FROM pool_schedules');
  }

  // Phone credentials — only push to gate when the linked person is an
  // active pool_member. Re-resolve each time so admin status changes
  // (active / suspended / removed) take effect on next sync.
  const credentials = [];

  // Credentials explicitly assigned in admin (RFID + wallet/NFC types)
  const nfcRows = await dbAll(`
    SELECT pnc.*
    FROM pool_nfc_credentials pnc
    JOIN pool_members pm ON pm.id = pnc.pool_member_id
    WHERE pnc.status = 'active' AND pm.status = 'active'
  `);
  for (const c of nfcRows) {
    credentials.push({
      id: c.id,
      pool_member_id: c.pool_member_id,
      credential_type: c.credential_type || 'nfc_phone',
      credential_hash: c.credential_hash,
      device_platform: c.device_platform,
      device_name: c.device_name,
      enrolled_at: c.created_at || c.pass_generated_at,
      status: c.status
    });
  }

  const phoneRows = await dbAll(`SELECT * FROM dir_pool_phones WHERE status='active'`);
  for (const p of phoneRows) {
    const pm = findPoolMemberForPerson(p.user_id, p.person_type, p.person_id);
    if (!pm) continue; // admin has not made this person an active pool guest
    if (!p.credential_token_hash) continue; // no QR credential — wallet pass handled separately
    credentials.push({
      id: p.id,
      pool_member_id: pm.id,
      credential_type: 'qr_static',
      credential_hash: p.credential_token_hash,
      device_platform: p.device_platform,
      device_name: p.device_label || `${p.person_name}'s phone`,
      enrolled_at: p.created_at,
      status: 'active'
    });
  }

  res.json({
    timestamp: new Date().toISOString(),
    entry_types,
    members,
    schedules,
    credentials
  });
});

// Receive batch check-in reports from gate controller
app.post('/api/gate/sync/checkins', requireGateKey, async (req, res) => {
  const { checkins } = req.body;
  if (!Array.isArray(checkins) || checkins.length === 0) {
    return res.status(400).json({ error: 'checkins array is required.' });
  }

  let imported = 0;
  let skipped = 0;
  for (const ci of checkins) {
    // Skip if already exists (idempotent)
    const existing = await dbGet('SELECT id FROM pool_checkins WHERE id = ?', [ci.id]);
    if (existing) { skipped++; continue; }
    
    await dbRun(`INSERT INTO pool_checkins (id, pool_member_id, entry_type_id, check_in_time, check_out_time, status, is_holiday, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [ci.id, ci.pool_member_id, ci.entry_type_id, ci.check_in_time, ci.check_out_time || null,
       ci.status || 'allowed', ci.is_holiday ? 1 : 0, ci.notes || null]);
    imported++;
  }

  res.json({ success: true, imported, skipped });
});

// Gate heartbeat — lets the Pi report its status
app.post('/api/gate/heartbeat', requireGateKey, async (req, res) => {
  const { device_id, uptime, last_sync, pending_checkins, version } = req.body;
  console.log(`  🚪 Gate heartbeat: device=${device_id} uptime=${uptime}s pending=${pending_checkins} v=${version}`);
  res.json({ success: true, server_time: new Date().toISOString() });
});

// ── Admin-facing proxy to the GateEntry Pi viewer ──────────────
// Lets the Pool Entry Management screen view the gate's local database
// (members, credentials, schedules, check-ins, sync log) and trigger a
// manual sync to bring the Pi in line with the website.
const GATE_VIEWER_URL = (process.env.GATE_VIEWER_URL || 'http://localhost:8080').replace(/\/$/, '');
const GATE_VIEWER_KEY = process.env.GATE_VIEWER_KEY || process.env.PHONE_UNLOCK_KEY || '';

async function fetchGateViewer(pathSuffix, { method = 'GET', body = null, timeoutMs = 8000 } = {}) {
  const url = `${GATE_VIEWER_URL}${pathSuffix}`;
  const headers = { 'Content-Type': 'application/json' };
  if (GATE_VIEWER_KEY) headers['X-Gate-Phone-Key'] = GATE_VIEWER_KEY;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

app.get('/api/admin/gate/snapshot', requireAdmin, async (req, res) => {
  try {
    const parts = await Promise.allSettled([
      fetchGateViewer('/api/viewer/summary'),
      fetchGateViewer('/api/viewer/members?limit=500'),
      fetchGateViewer('/api/viewer/credentials?limit=500'),
      fetchGateViewer('/api/viewer/schedules?limit=200'),
      fetchGateViewer('/api/viewer/checkins?limit=100'),
      fetchGateViewer('/api/viewer/sync-log?limit=25')
    ]);
    const labels = ['summary', 'members', 'credentials', 'schedules', 'checkins', 'syncLog'];
    const payload = { reachable: true, viewerUrl: GATE_VIEWER_URL };
    parts.forEach((p, i) => {
      if (p.status === 'fulfilled' && p.value.ok) {
        payload[labels[i]] = p.value.data;
      } else {
        payload[labels[i]] = null;
        if (p.status === 'rejected' || !p.value.ok) {
          payload.reachable = false;
          payload.error = payload.error || (
            p.status === 'rejected'
              ? ((p.reason && p.reason.message) || 'fetch failed')
              : `HTTP ${p.value.status}`);
        }
      }
    });
    res.json(payload);
  } catch (err) {
    res.status(502).json({
      reachable: false,
      viewerUrl: GATE_VIEWER_URL,
      error: (err && err.message) || 'Failed to contact gate.'
    });
  }
});

app.post('/api/admin/gate/sync', requireAdmin, async (req, res) => {
  try {
    const r = await fetchGateViewer('/api/viewer/sync', { method: 'POST', body: {}, timeoutMs: 60000 });
    if (!r.ok) {
      return res.status(502).json({
        success: false,
        error: (r.data && r.data.error) || `Gate returned HTTP ${r.status}`
      });
    }
    res.json({ success: true, ...r.data });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: (err && err.message) || 'Failed to contact gate.'
    });
  }
});

// ── Mobile App Gate Open ─────────────────────────────────
// Pool-member mobile app calls this to open the gate.
// Verifies session → pool member exists & active → optional geofence
// check → relays to the GateEntry Pi using the existing phone-unlock
// endpoint. The Pi runs the same scan pipeline as a physical RFID tap.
function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

app.post('/api/mobile/member/gate/open', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { latitude, longitude, device_id } = req.body || {};

    // 1. Verify the user is an active pool member
    const poolMember = await dbGet(
      `SELECT pm.*, pet.name AS entry_type_name
         FROM pool_members pm
         LEFT JOIN pool_entry_types pet ON pet.id = pm.entry_type_id
         WHERE pm.user_id = ? AND pm.status = 'active'
         LIMIT 1`,
      [userId]);
    if (!poolMember) {
      return res.status(403).json({
        allowed: false,
        reason: 'not_a_pool_member',
        message: 'Your account is not enrolled as an active pool member. Please contact the HOA admin.'
      });
    }

    // 2. Server-side geofence check (when configured + lat/lon supplied)
    if (POOL_LATITUDE && POOL_LONGITUDE && latitude != null && longitude != null) {
      const dist = haversineMeters(
        Number(latitude), Number(longitude),
        POOL_LATITUDE, POOL_LONGITUDE);
      if (dist > POOL_GEOFENCE_METERS) {
        return res.status(403).json({
          allowed: false,
          reason: 'outside_geofence',
          message: `You are too far from the pool gate (${Math.round(dist)} m).`
        });
      }
    }

    // 3. Find an active mobile credential for this pool member
    let credential = await dbGet(
      `SELECT * FROM pool_nfc_credentials
        WHERE pool_member_id = ?
          AND (revoked_at IS NULL)
        ORDER BY created_at DESC
        LIMIT 1`,
      [poolMember.id]);

    // Auto-issue a credential the first time the mobile app is used
    if (!credential) {
      const credentialToken = crypto.randomBytes(32).toString('hex');
      const credentialHash  = crypto.createHash('sha256').update(credentialToken).digest('hex');
      const credentialId    = uuidv4();
      await dbRun(`
        INSERT INTO pool_nfc_credentials
          (id, pool_member_id, credential_hash, device_platform, device_name, pass_serial, pass_generated_at)
        VALUES (?, ?, ?, 'mobile_app', ?, ?, CURRENT_TIMESTAMP)
      `, [credentialId, poolMember.id, credentialHash,
          `${poolMember.first_name} ${poolMember.last_name}'s phone`,
          uuidv4()]);
      credential = await dbGet('SELECT * FROM pool_nfc_credentials WHERE id = ?', [credentialId]);
    }

    // 4. Relay to the GateEntry Pi
    let piResult = { ok: false, status: 0, data: null };
    try {
      piResult = await fetchGateViewer('/api/gate/phone-unlock', {
        method: 'POST',
        body: {
          credential_type: 'nfc_phone',
          token: credential.credential_hash,
          device_platform: 'mobile_app',
          device_name: device_id || 'Mobile App'
        },
        timeoutMs: 5000
      });
    } catch (e) {
      console.warn('Gate Pi unreachable for mobile gate-open:', e.message);
    }

    // 5. Always log the attempt to pool_checkins so the HOA has a record,
    //    even if the Pi is offline.
    const checkinId = uuidv4();
    const status = piResult.ok && piResult.data && piResult.data.allowed ? 'allowed' : 'denied';
    const reason = (piResult.data && piResult.data.reason)
      || (piResult.ok ? 'opened_via_mobile_app' : 'gate_offline');
    await dbRun(`
      INSERT INTO pool_checkins
        (id, pool_member_id, person_name, entry_type_id, status, reason, check_in_time, source)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'mobile_app')
    `, [checkinId, poolMember.id,
        `${poolMember.first_name} ${poolMember.last_name}`,
        poolMember.entry_type_id, status, reason]);

    if (!piResult.ok) {
      return res.status(502).json({
        allowed: false,
        reason: 'gate_offline',
        message: 'Could not reach the gate controller. Please use your physical card or contact the HOA.',
        transaction_id: checkinId
      });
    }
    if (!piResult.data || !piResult.data.allowed) {
      return res.status(403).json({
        allowed: false,
        reason: (piResult.data && piResult.data.reason) || 'denied',
        message: 'Gate denied entry. Please check your pool schedule.',
        transaction_id: checkinId
      });
    }

    return res.json({
      allowed: true,
      reason: 'opened',
      member_name: `${poolMember.first_name} ${poolMember.last_name}`,
      timestamp: new Date().toISOString(),
      transaction_id: checkinId
    });

  } catch (err) {
    console.error('POST /api/mobile/member/gate/open error:', err);
    res.status(500).json({ allowed: false, reason: 'server_error', message: 'Unexpected error.' });
  }
});

// History of recent gate openings for the logged-in member.
app.get('/api/mobile/member/gate/history', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const limit = Math.min(parseInt(req.query.limit || '25', 10) || 25, 100);
    const poolMember = await dbGet(
      `SELECT id FROM pool_members WHERE user_id = ? AND status = 'active' LIMIT 1`,
      [userId]);
    if (!poolMember) return res.json([]);

    const rows = await dbAll(
      `SELECT id, person_name, status, reason, check_in_time
         FROM pool_checkins
         WHERE pool_member_id = ?
         ORDER BY check_in_time DESC
         LIMIT ?`,
      [poolMember.id, limit]);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/mobile/member/gate/history error:', err);
    res.status(500).json([]);
  }
});

// ── Start Server ────────────────────────────────────────
initDb().then(() => {
  app.listen(PORT, () => {
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log(`  ${BRAND_NAME} Server`);
    console.log(`  Running at http://localhost:${PORT}`);
    console.log(`  Admin panel: http://localhost:${PORT}/admin.html`);
    console.log('═══════════════════════════════════════════');
    console.log('');
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
