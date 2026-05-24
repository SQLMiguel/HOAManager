const { EventEmitter } = require('events');

const emitter = new EventEmitter();
const maxScans = 100;
const scans = [];
let latestScan = null;

function cleanString(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function recordScan(event) {
  const responseMs = Number(event.response_ms);
  const scan = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    scanned_at: new Date().toISOString(),
    source: cleanString(event.source) || 'unknown',
    status: cleanString(event.status) || 'unknown',
    reason: cleanString(event.reason) || null,
    response_ms: Number.isFinite(responseMs) ? responseMs : null,
    credential_type: cleanString(event.credential_type) || null,
    device_platform: cleanString(event.device_platform) || null,
    card_id: cleanString(event.card_id) || null,
    member: event.member || null,
    entry_type_name: cleanString(event.entry_type_name) || null
  };

  latestScan = scan;
  scans.unshift(scan);
  if (scans.length > maxScans) scans.pop();
  emitter.emit('scan', scan);
  return scan;
}

function getRecentScans(limit) {
  const parsed = parseInt(limit || 50, 10);
  const safeLimit = Number.isFinite(parsed) ? parsed : 50;
  const capped = Math.max(1, Math.min(safeLimit, maxScans));
  return scans.slice(0, capped);
}

function getLatestScan() {
  return latestScan;
}

function subscribe(listener) {
  emitter.on('scan', listener);
  return () => emitter.off('scan', listener);
}

module.exports = {
  recordScan,
  getRecentScans,
  getLatestScan,
  subscribe
};
