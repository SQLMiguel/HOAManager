const express = require('express');
const path = require('path');
const config = require('./config');
const db = require('./database');
const scanHandler = require('./scanHandler');
const scanEvents = require('./scanEvents');
const sync = require('./sync');

function startViewer() {
  const app = express();
  const publicDir = path.join(__dirname, '..', 'public');

  function getCookie(req, name) {
    const cookie = req.headers.cookie || '';
    const parts = cookie.split(';').map(part => part.trim());
    const prefix = `${name}=`;
    const match = parts.find(part => part.startsWith(prefix));
    return match ? decodeURIComponent(match.slice(prefix.length)) : '';
  }

  function getProvidedViewerKey(req) {
    return req.get('X-Gate-Viewer-Key')
      || req.get('X-Gate-Phone-Key')
      || req.query.gate_key
      || req.body?.gate_key
      || getCookie(req, 'gate_admin_key')
      || '';
  }

  function requireLiveViewerAuth(req, res, next) {
    if (!config.viewerAdminKey) return next();
    if (getProvidedViewerKey(req) === config.viewerAdminKey) return next();
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }

  function publishRejectedPhoneUnlock(reason) {
    scanEvents.recordScan({
      source: 'phone-unlock',
      status: 'denied',
      reason,
      credential_type: 'phone-unlock'
    });
  }

  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.use(express.static(publicDir));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'gateentry-viewer' });
  });

  app.get('/api/viewer/summary', (_req, res) => {
    res.json(db.getViewerSummary());
  });

  app.get('/api/viewer/members', (req, res) => {
    const { status, q, limit } = req.query;
    const rows = db.getMembersForViewer({ status, q, limit });
    res.json(rows);
  });

  app.get('/api/viewer/schedules', (req, res) => {
    const rows = db.getSchedulesForViewer(req.query.limit);
    res.json(rows);
  });

  app.get('/api/viewer/checkins', (req, res) => {
    const rows = db.getRecentCheckinsForViewer(req.query.limit);
    res.json(rows);
  });

  app.get('/api/viewer/sync-log', (req, res) => {
    const rows = db.getSyncLogForViewer(req.query.limit);
    res.json(rows);
  });

  app.get('/api/viewer/credentials', (req, res) => {
    const rows = db.getCredentialsForViewer({
      type: req.query.type,
      platform: req.query.platform,
      limit: req.query.limit
    });
    res.json(rows);
  });

  app.get('/api/viewer/live-scans', requireLiveViewerAuth, (req, res) => {
    res.json({
      latestScan: scanEvents.getLatestScan(),
      scans: scanEvents.getRecentScans(req.query.limit)
    });
  });

  app.get('/api/viewer/events', requireLiveViewerAuth, (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });

    function send(type, payload) {
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }

    send('ready', {
      ok: true,
      latestScan: scanEvents.getLatestScan(),
      scans: scanEvents.getRecentScans(20)
    });

    const unsubscribe = scanEvents.subscribe((scan) => send('scan', scan));
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 25000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  // Manual sync trigger — allows the website's admin Pool Entry Management
  // screen to force a pull/push cycle on demand. Protected by the same
  // shared key used for other privileged viewer actions (if configured).
  app.post('/api/viewer/sync', async (req, res) => {
    if (config.phoneUnlockKey) {
      const provided = req.get('X-Gate-Phone-Key') || req.body?.gate_key;
      if (provided !== config.phoneUnlockKey) {
        return res.status(401).json({ success: false, error: 'unauthorized' });
      }
    }
    try {
      const result = await sync.runSync();
      res.json({
        success: true,
        pulled: result.pulled,
        pushed: result.pushed,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: (err && err.message) || 'Sync failed.'
      });
    }
  });

  // ── Phone unlock endpoint ─────────────────────────────
  // Companion iOS / Android apps POST their credential here over the
  // local community Wi-Fi. Accepts any supported credential type and
  // runs the same validation pipeline as a physical RFID card scan.
  //
  //   POST /api/gate/phone-unlock
  //   {
  //     "credential_type": "qr_totp" | "qr_static" | "ble_token" | "nfc_phone",
  //     "token":          "123456" or token string,
  //     "device_platform":"ios" | "android" | "other",
  //     "device_name":    "Jane's iPhone" (optional)
  //   }
  //
  // Basic safety: requires a shared pre-key so random devices on the
  // LAN cannot probe credentials; rate-limits per remote address.
  const unlockAttempts = new Map(); // ip -> { count, resetAt }
  const UNLOCK_WINDOW_MS = 60 * 1000;
  const UNLOCK_MAX_PER_WINDOW = 20;

  function checkRateLimit(ip) {
    const now = Date.now();
    const entry = unlockAttempts.get(ip);
    if (!entry || entry.resetAt < now) {
      unlockAttempts.set(ip, { count: 1, resetAt: now + UNLOCK_WINDOW_MS });
      return true;
    }
    entry.count += 1;
    return entry.count <= UNLOCK_MAX_PER_WINDOW;
  }

  app.post('/api/gate/phone-unlock', (req, res) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    if (!checkRateLimit(ip)) {
      publishRejectedPhoneUnlock('rate_limited');
      return res.status(429).json({ allowed: false, reason: 'rate_limited' });
    }

    // Optional pre-shared gate key — set PHONE_UNLOCK_KEY to require it.
    if (config.phoneUnlockKey) {
      const provided = req.get('X-Gate-Phone-Key') || req.body?.gate_key;
      if (provided !== config.phoneUnlockKey) {
        publishRejectedPhoneUnlock('unauthorized');
        return res.status(401).json({ allowed: false, reason: 'unauthorized' });
      }
    }

    const body = req.body || {};
    const type = body.credential_type;
    const token = body.token;
    const allowed = ['qr_totp', 'qr_static', 'ble_token', 'nfc_phone'];
    if (!allowed.includes(type) || !token) {
      publishRejectedPhoneUnlock('invalid_request');
      return res.status(400).json({ allowed: false, reason: 'invalid_request' });
    }

    const result = scanHandler.handleScan(type, String(token), {
      source: 'phone-unlock',
      device_platform: body.device_platform || 'other'
    });

    if (result.allowed) {
      return res.json({ allowed: true, reason: result.reason, member: result.member });
    }
    return res.status(403).json({ allowed: false, reason: result.reason });
  });

  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  const server = app.listen(config.viewerPort, config.viewerHost, () => {
    console.log(`  ✓ Read-only viewer available at http://localhost:${config.viewerPort}`);
    console.log(`  ✓ Phone unlock endpoint: POST http://localhost:${config.viewerPort}/api/gate/phone-unlock`);
  });

  return server;
}

module.exports = { startViewer };
