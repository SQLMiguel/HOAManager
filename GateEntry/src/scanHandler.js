// ─── Unified Scan Handler ───────────────────────────────
// Validates any credential type through the same access-check pipeline:
//   - rfid         : physical card UID
//   - nfc_phone    : iPhone Wallet NFC pass or Android HCE tag UID
//   - ble_token    : BLE advertisement token (companion app)
//   - qr_static    : fixed token printed/embedded in a Wallet pass
//   - qr_totp      : rolling 6-digit TOTP token from the companion app
//
// Used by index.js (RFID polling) and viewer.js (phone unlock HTTP API).

const db = require('./database');
const gate = require('./gate');
const scanEvents = require('./scanEvents');

function publishScan(result, details) {
  scanEvents.recordScan({
    source: details.sourceLabel,
    status: result.allowed ? 'allowed' : (result.reason === 'unknown' ? 'unknown' : 'denied'),
    reason: result.reason,
    response_ms: Date.now() - details.scanStart,
    credential_type: details.credentialType,
    device_platform: result.device_platform || details.devicePlatform || null,
    card_id: details.cardId || null,
    member: result.member || details.member || null,
    entry_type_name: details.entryTypeName || null
  });
  return result;
}

function handleScan(credentialType, value, context) {
  const scanStart = Date.now();
  const sourceLabel = (context && context.source) || credentialType;
  const platformHint = context && context.device_platform;
  const displayValue = (credentialType === 'rfid' || credentialType === 'nfc_phone')
    ? value
    : '***';
  console.log(`\n┌─ Scan [${sourceLabel}]: ${displayValue}`);

  const member = db.lookupByCredential(credentialType, value);

  if (!member) {
    console.log(`│  ✗ Unknown ${credentialType} credential`);
    console.log(`└─ Response time: ${Date.now() - scanStart}ms`);
    gate.unknownTag();
    return publishScan({ allowed: false, reason: 'unknown' }, {
      sourceLabel,
      scanStart,
      credentialType,
      devicePlatform: platformHint,
      cardId: displayValue === '***' ? null : displayValue
    });
  }

  const credInfo = {
    credential_type: member.credential_type || credentialType,
    credential_id: member.credential_id || null,
    device_platform: member.device_platform || platformHint || (credentialType === 'rfid' ? 'card' : 'other')
  };

  console.log(`│  Member: ${member.first_name} ${member.last_name} (${member.entry_type_name}) via ${credInfo.credential_type}/${credInfo.device_platform}`);

  if (member.status !== 'active') {
    console.log(`│  ✗ Member status: ${member.status}`);
    console.log(`└─ Response time: ${Date.now() - scanStart}ms`);
    gate.denyAccess();
    db.recordCheckin(member.id, member.entry_type_id, 'denied', false, `Status: ${member.status}`, credInfo);
    return publishScan({ allowed: false, reason: `status:${member.status}` }, {
      sourceLabel,
      scanStart,
      credentialType: credInfo.credential_type,
      devicePlatform: credInfo.device_platform,
      cardId: displayValue === '***' ? null : displayValue,
      member: { id: member.id, first_name: member.first_name, last_name: member.last_name },
      entryTypeName: member.entry_type_name
    });
  }

  const access = db.checkAccess(member);

  if (access.allowed) {
    console.log(`│  ✓ ACCESS GRANTED — ${access.reason}`);
    console.log(`└─ Response time: ${Date.now() - scanStart}ms`);
    gate.openGate();
    db.recordCheckin(member.id, member.entry_type_id, 'allowed', access.isHoliday, access.reason, credInfo);
    return publishScan({
      allowed: true,
      reason: access.reason,
      member: { id: member.id, first_name: member.first_name, last_name: member.last_name },
      credential_type: credInfo.credential_type,
      device_platform: credInfo.device_platform
    }, {
      sourceLabel,
      scanStart,
      credentialType: credInfo.credential_type,
      devicePlatform: credInfo.device_platform,
      cardId: displayValue === '***' ? null : displayValue,
      entryTypeName: member.entry_type_name
    });
  }

  console.log(`│  ✗ ACCESS DENIED — ${access.reason}`);
  console.log(`└─ Response time: ${Date.now() - scanStart}ms`);
  gate.denyAccess();
  db.recordCheckin(member.id, member.entry_type_id, 'denied', access.isHoliday, access.reason, credInfo);
  return publishScan({ allowed: false, reason: access.reason }, {
    sourceLabel,
    scanStart,
    credentialType: credInfo.credential_type,
    devicePlatform: credInfo.device_platform,
    cardId: displayValue === '***' ? null : displayValue,
    member: { id: member.id, first_name: member.first_name, last_name: member.last_name },
    entryTypeName: member.entry_type_name
  });
}

module.exports = { handleScan };
