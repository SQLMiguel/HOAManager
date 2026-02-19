/* ===================================
   Glenridge Community HOA — Server
   Express + SQLite + Nodemailer
   =================================== */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const initSqlJs = require('sql.js');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;

const app = express();
const PORT = process.env.PORT || 3000;
const SALT_ROUNDS = 12;

// ── Database Setup ──────────────────────────────────────
const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'glenridge.db');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

let db;

async function initDb() {
  const SQL = await initSqlJs();
  
  // Load existing database or create new one
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Create users table (password_hash nullable to support OAuth users)
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      address TEXT NOT NULL,
      phone TEXT,
      password_hash TEXT,
      oauth_provider TEXT,
      oauth_provider_id TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'denied')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      approved_at DATETIME,
      approved_by TEXT
    )
  `);

  // Migrate existing tables: add oauth columns if they don't exist
  const cols = dbAll(`PRAGMA table_info(users)`);
  const colNames = cols.map(c => c.name);
  if (!colNames.includes('oauth_provider')) {
    db.run(`ALTER TABLE users ADD COLUMN oauth_provider TEXT`);
  }
  if (!colNames.includes('oauth_provider_id')) {
    db.run(`ALTER TABLE users ADD COLUMN oauth_provider_id TEXT`);
  }

  // ── Directory tables ───────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS dir_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
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
      is_published INTEGER DEFAULT 0,
      consent_given INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS dir_adults (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      birthday TEXT,
      show_birthday INTEGER DEFAULT 0,
      is_visible INTEGER DEFAULT 1
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS dir_children (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      first_name TEXT NOT NULL,
      birth_month INTEGER,
      birth_day INTEGER,
      show_birthday INTEGER DEFAULT 0,
      is_visible INTEGER DEFAULT 1
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS dir_pets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      pet_type TEXT,
      is_visible INTEGER DEFAULT 1
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS dir_social (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      url TEXT NOT NULL,
      is_visible INTEGER DEFAULT 1
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS dir_photos (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      category TEXT DEFAULT 'Household',
      caption TEXT,
      is_visible INTEGER DEFAULT 1,
      display_order INTEGER DEFAULT 0,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS dir_audit (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      ts DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Community events table
  db.run(`
    CREATE TABLE IF NOT EXISTS community_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      event_date TEXT NOT NULL,
      event_time TEXT,
      location TEXT,
      created_by_id TEXT NOT NULL,
      created_by_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Newsletter tables ───────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS nl_newsletters (
      id TEXT PRIMARY KEY,
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
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS nl_subscribers (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      first_name TEXT,
      last_name TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('active','unsubscribed','bounced')),
      subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      unsubscribed_at DATETIME,
      unsubscribe_token TEXT UNIQUE,
      bounce_count INTEGER DEFAULT 0,
      source TEXT DEFAULT 'member'
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS nl_send_log (
      id TEXT PRIMARY KEY,
      newsletter_id TEXT NOT NULL,
      subscriber_id TEXT NOT NULL,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      delivery_status TEXT DEFAULT 'sent'
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS nl_engagement (
      id TEXT PRIMARY KEY,
      send_log_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      url TEXT,
      occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  saveDb();
}

function saveDb() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// Helper to run a query and get results as array of objects
function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function dbGet(sql, params = []) {
  const results = dbAll(sql, params);
  return results.length > 0 ? results[0] : null;
}

function dbRun(sql, params = []) {
  db.run(sql, params);
  saveDb();
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

// Verify email config on startup (non-blocking)
transporter.verify().then(() => {
  console.log('✓ Email server connection verified');
}).catch(err => {
  console.warn('⚠ Email server not configured or unreachable. Emails will be logged to console.');
  console.warn('  Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in .env');
});

async function sendEmail(to, subject, html) {
  const mailOptions = {
    from: `"Glenridge Community HOA" <${process.env.SMTP_USER || 'noreply@glenridgecommunity.com'}>`,
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

// ── Middleware ───────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'glenridge-fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// ── Passport Setup ───────────────────────────────────────
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  const user = dbGet('SELECT * FROM users WHERE id = ?', [id]);
  done(null, user || false);
});

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${process.env.SITE_URL || 'http://localhost:3000'}/api/auth/google/callback`
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value?.toLowerCase();
      let user = dbGet('SELECT * FROM users WHERE oauth_provider = ? AND oauth_provider_id = ?', ['google', profile.id]);
      if (!user && email) {
        user = dbGet('SELECT * FROM users WHERE email = ?', [email]);
        if (user) {
          // Link existing email account to Google
          dbRun('UPDATE users SET oauth_provider = ?, oauth_provider_id = ? WHERE id = ?', ['google', profile.id, user.id]);
          user = dbGet('SELECT * FROM users WHERE id = ?', [user.id]);
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
    callbackURL: `${process.env.SITE_URL || 'http://localhost:3000'}/api/auth/facebook/callback`,
    profileFields: ['id', 'emails', 'name']
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value?.toLowerCase();
      let user = dbGet('SELECT * FROM users WHERE oauth_provider = ? AND oauth_provider_id = ?', ['facebook', profile.id]);
      if (!user && email) {
        user = dbGet('SELECT * FROM users WHERE email = ?', [email]);
        if (user) {
          dbRun('UPDATE users SET oauth_provider = ?, oauth_provider_id = ? WHERE id = ?', ['facebook', profile.id, user.id]);
          user = dbGet('SELECT * FROM users WHERE id = ?', [user.id]);
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
app.get('/api/auth/pending-social', (req, res) => {
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

    if (!pending.email) {
      return res.status(400).json({ error: `Your ${pending.provider} account did not share an email address. Please sign up manually.` });
    }

    const email = pending.email.toLowerCase().trim();
    const existing = dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists. Please log in instead.' });
    }

    const userId = uuidv4();
    dbRun(`
      INSERT INTO users (id, first_name, last_name, email, address, phone, password_hash, oauth_provider, oauth_provider_id, status)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'pending')
    `, [userId, firstName.trim(), lastName.trim(), email, address.trim(), phone?.trim() || null, pending.provider, pending.providerId]);

    delete req.session.pendingSocial;
    saveDb();

    const adminUrl = `${process.env.SITE_URL || 'http://localhost:3000'}/admin.html`;
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
        <div style="padding: 16px; text-align: center; color: #888; font-size: 13px;">Glenridge Community HOA</div>
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

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    // Check for existing email
    const existing = dbGet('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // Hash password and create user
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const userId = uuidv4();

    dbRun(`
      INSERT INTO users (id, first_name, last_name, email, address, phone, password_hash, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `, [userId, firstName.trim(), lastName.trim(), email.toLowerCase().trim(), address.trim(), phone?.trim() || null, passwordHash]);

    // Send notification email to admin
    const adminUrl = `${process.env.SITE_URL || 'http://localhost:3000'}/admin.html`;
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
          Glenridge Community HOA
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

    const user = dbGet('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);

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
      return res.status(403).json({ error: 'Your account has been denied. Please contact admin@glenridgecommunity.com for assistance.' });
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

// ---------- Logout ----------
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ---------- Get current user ----------
app.get('/api/me', (req, res) => {
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

// ── Community Events Routes ──────────────────────────────

// Get all events (members only)
app.get('/api/events', requireAuth, (req, res) => {
  const events = dbAll(`
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
    dbRun(`
      INSERT INTO community_events (id, title, description, event_date, event_time, location, created_by_id, created_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, title.trim(), description?.trim() || null, event_date, event_time?.trim() || null, location?.trim() || null,
        req.session.userId, req.session.userName]);
    const event = dbGet('SELECT * FROM community_events WHERE id = ?', [id]);

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
            <a href="${process.env.SITE_URL || 'http://localhost:3000'}/members.html" style="background:#2d6a4f;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;display:inline-block;">View Calendar</a>
          </div>
        </div>
        <div style="padding:16px;text-align:center;color:#888;font-size:13px;">Glenridge Community HOA</div>
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
  const event = dbGet('SELECT * FROM community_events WHERE id = ?', [req.params.id]);
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  if (event.created_by_id !== req.session.userId && !req.session.isAdmin) {
    return res.status(403).json({ error: 'You can only delete your own events.' });
  }
  dbRun('DELETE FROM community_events WHERE id = ?', [req.params.id]);

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
      <div style="padding:16px;text-align:center;color:#888;font-size:13px;">Glenridge Community HOA</div>
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

function dirAudit(userId, action, detail) {
  try { dbRun('INSERT INTO dir_audit (id,user_id,action,detail) VALUES (?,?,?,?)', [uuidv4(), userId, action, detail || null]); } catch (e) {}
}

function buildProfile(userId) {
  const user    = dbGet('SELECT first_name, last_name, email, address FROM users WHERE id=?', [userId]);
  const profile = dbGet('SELECT * FROM dir_profiles WHERE user_id=?', [userId]);
  const adults  = dbAll('SELECT * FROM dir_adults WHERE user_id=? ORDER BY rowid', [userId]);
  const children= dbAll('SELECT * FROM dir_children WHERE user_id=? ORDER BY rowid', [userId]);
  const pets    = dbAll('SELECT * FROM dir_pets WHERE user_id=? ORDER BY rowid', [userId]);
  const social  = dbAll('SELECT * FROM dir_social WHERE user_id=? ORDER BY rowid', [userId]);
  const photos  = dbAll('SELECT * FROM dir_photos WHERE user_id=? ORDER BY display_order, uploaded_at', [userId]);
  return { user, profile, adults, children, pets, social, photos };
}

// GET /api/directory - list all approved members (opt-out model: hidden only if do_not_list=1)
app.get('/api/directory', requireAuth, (req, res) => {
  try {
    const approvedUsers = dbAll(`SELECT id FROM users WHERE status='approved'`);
    const result = approvedUsers
      .map(row => buildProfile(row.id))
      .filter(p => {
        if (!p.user) return false;
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
app.get('/api/directory/me', requireAuth, (req, res) => {
  try {
    res.json(buildProfile(req.session.userId));
  } catch (err) {
    console.error('GET /api/directory/me error:', err.message);
    res.status(500).json({ error: 'Failed to load profile.' });
  }
});

// POST /api/directory/profile - create or update core profile
app.post('/api/directory/profile', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const { display_name, phone, show_phone, show_email, anniversary, show_anniversary,
          interests, show_interests, notes, show_notes, do_not_list, is_published, consent_given } = req.body;
  const existing = dbGet('SELECT id FROM dir_profiles WHERE user_id=?', [uid]);
  if (existing) {
    dbRun(`UPDATE dir_profiles SET display_name=?,phone=?,show_phone=?,show_email=?,anniversary=?,show_anniversary=?,
      interests=?,show_interests=?,notes=?,show_notes=?,do_not_list=?,is_published=?,consent_given=?,updated_at=CURRENT_TIMESTAMP
      WHERE user_id=?`,
      [display_name||null, phone||null, show_phone?1:0, show_email?1:0,
       anniversary||null, show_anniversary?1:0, interests||null, show_interests?1:0,
       notes||null, show_notes?1:0, do_not_list?1:0, is_published?1:0, consent_given?1:0, uid]);
  } else {
    dbRun(`INSERT INTO dir_profiles (id,user_id,display_name,phone,show_phone,show_email,anniversary,show_anniversary,
      interests,show_interests,notes,show_notes,do_not_list,is_published,consent_given)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [uuidv4(), uid, display_name||null, phone||null, show_phone?1:0, show_email?1:0,
       anniversary||null, show_anniversary?1:0, interests||null, show_interests?1:0,
       notes||null, show_notes?1:0, do_not_list?1:0, is_published?1:0, consent_given?1:0]);
  }
  dirAudit(uid, 'profile_updated', null);
  res.json({ success: true, profile: buildProfile(uid) });
});

// POST /api/directory/adults
app.post('/api/directory/adults', requireAuth, (req, res) => {
  const { name, birthday, show_birthday, is_visible } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  const id = uuidv4();
  dbRun('INSERT INTO dir_adults (id,user_id,name,birthday,show_birthday,is_visible) VALUES (?,?,?,?,?,?)',
    [id, req.session.userId, name.trim(), birthday||null, show_birthday?1:0, is_visible!==false?1:0]);
  res.json({ success: true, adult: dbGet('SELECT * FROM dir_adults WHERE id=?', [id]) });
});
app.delete('/api/directory/adults/:id', requireAuth, (req, res) => {
  dbRun('DELETE FROM dir_adults WHERE id=? AND user_id=?', [req.params.id, req.session.userId]);
  res.json({ success: true });
});

// POST /api/directory/children
app.post('/api/directory/children', requireAuth, (req, res) => {
  const { first_name, birth_month, birth_day, show_birthday, is_visible } = req.body;
  if (!first_name) return res.status(400).json({ error: 'First name is required.' });
  const id = uuidv4();
  dbRun('INSERT INTO dir_children (id,user_id,first_name,birth_month,birth_day,show_birthday,is_visible) VALUES (?,?,?,?,?,?,?)',
    [id, req.session.userId, first_name.trim(), birth_month||null, birth_day||null, show_birthday?1:0, is_visible!==false?1:0]);
  res.json({ success: true, child: dbGet('SELECT * FROM dir_children WHERE id=?', [id]) });
});
app.delete('/api/directory/children/:id', requireAuth, (req, res) => {
  dbRun('DELETE FROM dir_children WHERE id=? AND user_id=?', [req.params.id, req.session.userId]);
  res.json({ success: true });
});

// POST /api/directory/pets
app.post('/api/directory/pets', requireAuth, (req, res) => {
  const { name, pet_type, is_visible } = req.body;
  if (!name) return res.status(400).json({ error: 'Pet name is required.' });
  const id = uuidv4();
  dbRun('INSERT INTO dir_pets (id,user_id,name,pet_type,is_visible) VALUES (?,?,?,?,?)',
    [id, req.session.userId, name.trim(), pet_type||null, is_visible!==false?1:0]);
  res.json({ success: true, pet: dbGet('SELECT * FROM dir_pets WHERE id=?', [id]) });
});
app.delete('/api/directory/pets/:id', requireAuth, (req, res) => {
  dbRun('DELETE FROM dir_pets WHERE id=? AND user_id=?', [req.params.id, req.session.userId]);
  res.json({ success: true });
});

// POST /api/directory/social
app.post('/api/directory/social', requireAuth, (req, res) => {
  const { platform, url, is_visible } = req.body;
  if (!platform || !url) return res.status(400).json({ error: 'Platform and URL are required.' });
  const id = uuidv4();
  dbRun('INSERT INTO dir_social (id,user_id,platform,url,is_visible) VALUES (?,?,?,?,?)',
    [id, req.session.userId, platform.trim(), url.trim(), is_visible!==false?1:0]);
  res.json({ success: true, social: dbGet('SELECT * FROM dir_social WHERE id=?', [id]) });
});
app.delete('/api/directory/social/:id', requireAuth, (req, res) => {
  dbRun('DELETE FROM dir_social WHERE id=? AND user_id=?', [req.params.id, req.session.userId]);
  res.json({ success: true });
});

// POST /api/directory/photos
app.post('/api/directory/photos', requireAuth, (req, res) => {
  dirUpload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const photoCount = dbAll('SELECT id FROM dir_photos WHERE user_id=?', [req.session.userId]).length;
    if (photoCount >= 20) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Maximum of 20 photos allowed.' });
    }
    const { category, caption } = req.body;
    const id = uuidv4();
    const webPath = `/images/directory/${req.session.userId}/${req.file.filename}`;
    dbRun('INSERT INTO dir_photos (id,user_id,filename,category,caption,display_order) VALUES (?,?,?,?,?,?)',
      [id, req.session.userId, webPath, category||'Household', caption||null, photoCount]);
    dirAudit(req.session.userId, 'photo_uploaded', req.file.filename);
    res.json({ success: true, photo: dbGet('SELECT * FROM dir_photos WHERE id=?', [id]) });
  });
});
app.put('/api/directory/photos/:id', requireAuth, (req, res) => {
  const { caption, is_visible, category, display_order } = req.body;
  dbRun(`UPDATE dir_photos SET caption=?,is_visible=?,category=?,display_order=? WHERE id=? AND user_id=?`,
    [caption||null, is_visible?1:0, category||'Household', display_order||0, req.params.id, req.session.userId]);
  res.json({ success: true });
});
app.delete('/api/directory/photos/:id', requireAuth, (req, res) => {
  const photo = dbGet('SELECT * FROM dir_photos WHERE id=? AND user_id=?', [req.params.id, req.session.userId]);
  if (!photo) return res.status(404).json({ error: 'Photo not found.' });
  const fullPath = path.join(__dirname, photo.filename);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  dbRun('DELETE FROM dir_photos WHERE id=?', [req.params.id]);
  dirAudit(req.session.userId, 'photo_deleted', photo.filename);
  res.json({ success: true });
});

// GET /api/directory/print
app.get('/api/directory/print', requireAuth, (req, res) => {
  dirAudit(req.session.userId, 'print_generated', null);
  const approvedUsers = dbAll(`SELECT id FROM users WHERE status='approved'`);
  const result = approvedUsers
    .map(row => buildProfile(row.id))
    .filter(p => p.user && !(p.profile && p.profile.do_not_list))
    .sort((a, b) => {
      const nameA = (a.profile && a.profile.display_name) || `${a.user.last_name} ${a.user.first_name}`;
      const nameB = (b.profile && b.profile.display_name) || `${b.user.last_name} ${b.user.first_name}`;
      return nameA.localeCompare(nameB);
    });
  res.json(result);
});

// ── Admin Routes ────────────────────────────────────────

// Admin login
app.post('/api/admin/login', (req, res) => {
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
app.post('/api/admin/logout', (req, res) => {
  req.session.isAdmin = false;
  req.session.destroy();
  res.json({ success: true });
});

// Check admin status
app.get('/api/admin/status', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// Get all pending users
app.get('/api/admin/users/pending', requireAdmin, (req, res) => {
  const users = dbAll(`
    SELECT id, first_name, last_name, email, address, phone, status, created_at
    FROM users WHERE status = 'pending'
    ORDER BY created_at DESC
  `);
  res.json(users);
});

// Get all users
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = dbAll(`
    SELECT id, first_name, last_name, email, address, phone, status, created_at, approved_at
    FROM users
    ORDER BY created_at DESC
  `);
  res.json(users);
});

// Approve user
app.post('/api/admin/users/:id/approve', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const user = dbGet('SELECT * FROM users WHERE id = ?', [id]);

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    dbRun(`
      UPDATE users SET status = 'approved', approved_at = CURRENT_TIMESTAMP, approved_by = 'admin'
      WHERE id = ?
    `, [id]);

    // Send approval email to the resident
    await sendEmail(
      user.email,
      '✅ Welcome to Glenridge Community — Account Approved!',
      `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #2d6a4f; color: white; padding: 24px; border-radius: 12px 12px 0 0;">
          <h1 style="margin: 0; font-size: 20px;">Account Approved!</h1>
        </div>
        <div style="background: #f8f9fa; padding: 24px; border: 1px solid #e0e0e0;">
          <p>Hello ${user.first_name},</p>
          <p>Great news! Your Glenridge Community HOA member account has been approved. You can now log in to access exclusive member resources including:</p>
          <ul style="line-height: 2;">
            <li>Pool information &amp; schedules</li>
            <li>Events calendar</li>
            <li>The Glenridge Times newsletters</li>
            <li>Recommended vendors</li>
            <li>And much more!</li>
          </ul>
          <div style="margin-top: 24px; text-align: center;">
            <a href="${process.env.SITE_URL || 'http://localhost:3000'}/members.html" style="background: #2d6a4f; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; display: inline-block;">Log In Now</a>
          </div>
        </div>
        <div style="padding: 16px; text-align: center; color: #888; font-size: 13px;">
          Glenridge Community HOA &bull; Winston-Salem, NC
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
    const user = dbGet('SELECT * FROM users WHERE id = ?', [id]);

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    dbRun(`UPDATE users SET status = 'denied' WHERE id = ?`, [id]);

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
          <p>We were unable to verify your residency in the Glenridge Community at this time. If you believe this is an error, please contact us at <a href="mailto:admin@glenridgecommunity.com">admin@glenridgecommunity.com</a> with your address and proof of residency.</p>
        </div>
        <div style="padding: 16px; text-align: center; color: #888; font-size: 13px;">
          Glenridge Community HOA &bull; Winston-Salem, NC
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
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  dbRun('DELETE FROM users WHERE id = ?', [id]);
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

function syncSubscribers() {
  const approved = dbAll(`SELECT id, first_name, last_name, email FROM users WHERE status='approved'`);
  approved.forEach(u => {
    const existing = dbGet(`SELECT id FROM nl_subscribers WHERE email=?`, [u.email]);
    if (!existing) {
      dbRun(`INSERT INTO nl_subscribers (id, email, first_name, last_name, unsubscribe_token, source)
             VALUES (?,?,?,?,?,'member')`,
            [uuidv4(), u.email, u.first_name, u.last_name, uuidv4()]);
    }
  });
}

function siteUrl() { return process.env.SITE_URL || 'http://localhost:3000'; }

function buildSendHtml(htmlContent, sendLogId, unsubToken) {
  const base = siteUrl();
  let html = htmlContent.replace(/href="(https?:\/\/[^"]+)"/g, (match, url) => {
    if (url.includes('/api/nl/track/') || url.includes('/unsubscribe')) return match;
    return `href="${base}/api/nl/track/click/${sendLogId}/${unsubToken}?url=${encodeURIComponent(url)}"`;
  });
  const pixel = `<img src="${base}/api/nl/track/open/${sendLogId}/${unsubToken}" width="1" height="1" alt="" style="display:none;">`;
  return html.replace('</body>', pixel + '</body>');
}

app.get('/api/nl/newsletters', requireAdmin, (req, res) => {
  const rows = dbAll(`SELECT id,subject,status,sent_at,recipient_count,created_at,updated_at FROM nl_newsletters ORDER BY created_at DESC`);
  res.json(rows);
});

app.get('/api/nl/newsletters/:id', requireAdmin, (req, res) => {
  const row = dbGet(`SELECT * FROM nl_newsletters WHERE id=?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

app.post('/api/nl/newsletters', requireAdmin, (req, res) => {
  const { subject, preview_text, html_content, blocks_json } = req.body;
  if (!subject) return res.status(400).json({ error: 'Subject required' });
  const id = uuidv4();
  dbRun(`INSERT INTO nl_newsletters (id,subject,preview_text,html_content,blocks_json,created_by) VALUES (?,?,?,?,?,?)`,
        [id, subject, preview_text||'', html_content||'', blocks_json||'[]', 'admin']);
  res.json({ success: true, id });
});

app.put('/api/nl/newsletters/:id', requireAdmin, (req, res) => {
  const { subject, preview_text, html_content, blocks_json } = req.body;
  const nl = dbGet(`SELECT id,status FROM nl_newsletters WHERE id=?`, [req.params.id]);
  if (!nl) return res.status(404).json({ error: 'Not found' });
  if (nl.status === 'sent') return res.status(400).json({ error: 'Cannot edit sent newsletter' });
  dbRun(`UPDATE nl_newsletters SET subject=?,preview_text=?,html_content=?,blocks_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [subject, preview_text||'', html_content||'', blocks_json||'[]', req.params.id]);
  res.json({ success: true });
});

app.delete('/api/nl/newsletters/:id', requireAdmin, (req, res) => {
  dbRun(`DELETE FROM nl_newsletters WHERE id=?`, [req.params.id]);
  res.json({ success: true });
});

app.post('/api/nl/images', requireAdmin, nlUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: `/images/newsletter/${req.file.filename}` });
});

app.post('/api/nl/newsletters/:id/test', requireAdmin, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const nl = dbGet(`SELECT * FROM nl_newsletters WHERE id=?`, [req.params.id]);
  if (!nl) return res.status(404).json({ error: 'Not found' });
  const html = nl.html_content.replace(/\{\{UNSUBSCRIBE_URL\}\}/g,'#').replace(/\{\{FIRST_NAME\}\}/g,'Neighbor');
  try {
    await transporter.sendMail({
      from: `"Glenridge Community HOA" <${process.env.SMTP_USER}>`,
      to: email, subject: `[TEST] ${nl.subject}`, html
    });
    res.json({ success: true });
  } catch {
    console.log(`[Newsletter Test] Would send to ${email}: ${nl.subject}`);
    res.json({ success: true, note: 'SMTP not configured — logged to console' });
  }
});

app.post('/api/nl/newsletters/:id/send', requireAdmin, async (req, res) => {
  const nl = dbGet(`SELECT * FROM nl_newsletters WHERE id=?`, [req.params.id]);
  if (!nl) return res.status(404).json({ error: 'Not found' });
  if (nl.status === 'sent') return res.status(400).json({ error: 'Already sent' });
  syncSubscribers();
  const subscribers = dbAll(`SELECT * FROM nl_subscribers WHERE status='active'`);
  if (!subscribers.length) return res.status(400).json({ error: 'No active subscribers' });
  dbRun(`UPDATE nl_newsletters SET status='sent',sent_at=CURRENT_TIMESTAMP,recipient_count=? WHERE id=?`,
        [subscribers.length, nl.id]);
  let sent = 0;
  for (const sub of subscribers) {
    const sendId = uuidv4();
    dbRun(`INSERT INTO nl_send_log (id,newsletter_id,subscriber_id) VALUES (?,?,?)`, [sendId, nl.id, sub.id]);
    const unsubUrl = `${siteUrl()}/unsubscribe.html?token=${sub.unsubscribe_token}`;
    const html = buildSendHtml(
      nl.html_content.replace(/\{\{UNSUBSCRIBE_URL\}\}/g, unsubUrl).replace(/\{\{FIRST_NAME\}\}/g, sub.first_name||'Neighbor'),
      sendId, sub.unsubscribe_token
    );
    try {
      await transporter.sendMail({
        from: `"Glenridge Community HOA" <${process.env.SMTP_USER}>`,
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

app.get('/api/nl/newsletters/:id/analytics', requireAdmin, (req, res) => {
  const nl = dbGet(`SELECT id,subject,sent_at,recipient_count,status FROM nl_newsletters WHERE id=?`, [req.params.id]);
  if (!nl) return res.status(404).json({ error: 'Not found' });
  const logs   = dbAll(`SELECT id FROM nl_send_log WHERE newsletter_id=?`, [nl.id]);
  const logIds = logs.map(l => l.id);
  let opens=0,uniqueOpens=0,clicks=0,uniqueClicks=0;
  const clickMap = {};
  if (logIds.length) {
    const ph = logIds.map(()=>'?').join(',');
    const eng = dbAll(`SELECT send_log_id,event_type,url FROM nl_engagement WHERE send_log_id IN (${ph})`, logIds);
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

app.get('/api/nl/subscribers', requireAdmin, (req, res) => {
  syncSubscribers();
  res.json(dbAll(`SELECT id,email,first_name,last_name,status,subscribed_at,unsubscribed_at,source FROM nl_subscribers ORDER BY subscribed_at DESC`));
});

app.post('/api/nl/subscribers', requireAdmin, (req, res) => {
  const { email, first_name, last_name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  if (dbGet(`SELECT id FROM nl_subscribers WHERE email=?`, [email])) return res.status(409).json({ error: 'Already subscribed' });
  dbRun(`INSERT INTO nl_subscribers (id,email,first_name,last_name,unsubscribe_token,source) VALUES (?,?,?,?,'manual')`,
        [uuidv4(), email, first_name||'', last_name||'', uuidv4()]);
  res.json({ success: true });
});

app.delete('/api/nl/subscribers/:id', requireAdmin, (req, res) => {
  dbRun(`UPDATE nl_subscribers SET status='unsubscribed',unsubscribed_at=CURRENT_TIMESTAMP WHERE id=?`, [req.params.id]);
  res.json({ success: true });
});

app.get('/api/nl/track/open/:sendLogId/:token', (req, res) => {
  const { sendLogId, token } = req.params;
  const sub = dbGet(`SELECT id FROM nl_subscribers WHERE unsubscribe_token=?`, [token]);
  const log = dbGet(`SELECT id FROM nl_send_log WHERE id=?`, [sendLogId]);
  if (sub && log) dbRun(`INSERT INTO nl_engagement (id,send_log_id,event_type) VALUES (?,?,'open')`, [uuidv4(), sendLogId]);
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
  res.writeHead(200,{'Content-Type':'image/gif','Content-Length':gif.length,'Cache-Control':'no-store','Pragma':'no-cache'});
  res.end(gif);
});

app.get('/api/nl/track/click/:sendLogId/:token', (req, res) => {
  const { sendLogId, token } = req.params;
  const url = req.query.url||'/';
  const sub = dbGet(`SELECT id FROM nl_subscribers WHERE unsubscribe_token=?`, [token]);
  const log = dbGet(`SELECT id FROM nl_send_log WHERE id=?`, [sendLogId]);
  if (sub && log) dbRun(`INSERT INTO nl_engagement (id,send_log_id,event_type,url) VALUES (?,?,'click',?)`, [uuidv4(), sendLogId, url]);
  res.redirect(url);
});

app.get('/api/nl/unsubscribe', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Missing token' });
  const sub = dbGet(`SELECT id,status FROM nl_subscribers WHERE unsubscribe_token=?`, [token]);
  if (!sub) return res.status(404).json({ error: 'Invalid token' });
  if (sub.status !== 'unsubscribed')
    dbRun(`UPDATE nl_subscribers SET status='unsubscribed',unsubscribed_at=CURRENT_TIMESTAMP WHERE id=?`, [sub.id]);
  res.json({ success: true });
});

// ── Start Server ────────────────────────────────────────
initDb().then(() => {
  app.listen(PORT, () => {
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log(`  Glenridge Community HOA Server`);
    console.log(`  Running at http://localhost:${PORT}`);
    console.log(`  Admin panel: http://localhost:${PORT}/admin.html`);
    console.log('═══════════════════════════════════════════');
    console.log('');
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
