function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString();
}

function statusPill(v) {
  const t = (v || '').toString().toLowerCase();
  return `<span class="status-pill status-${t}">${v || '—'}</span>`;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function renderSummary(summary) {
  const creds = summary.credentials || { total: 0, ios: 0, android: 0, card: 0 };
  const cards = [
    ['Active Members', summary.activeMembers],
    ['Suspended', summary.suspendedMembers],
    ['Inactive', summary.inactiveMembers],
    ['RFID / Cards', creds.card || summary.rfidAssigned],
    ['iPhone Credentials', creds.ios || 0],
    ['Android Credentials', creds.android || 0],
    ['Active Schedules', summary.activeSchedules],
    ['Pending Sync', summary.pendingSync],
    ['Total Check-ins', summary.totalCheckins],
    ['Last Pull Sync', summary.lastSync ? fmtDate(summary.lastSync) : 'Never']
  ];
  document.getElementById('summaryCards').innerHTML = cards.map(([k, v]) =>
    `<article class="card"><div class="label">${k}</div><div class="value">${v}</div></article>`
  ).join('');
}

function renderMembers(rows) {
  const body = document.getElementById('membersBody');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5">No members found.</td></tr>';
    return;
  }
  body.innerHTML = rows.map(r => `
    <tr>
      <td>${r.first_name} ${r.last_name}</td>
      <td>${r.entry_type_name || '—'}</td>
      <td>${statusPill(r.status)}</td>
      <td>${r.rfid_tag || '—'}</td>
      <td>${r.source || '—'}</td>
    </tr>
  `).join('');
}

function credentialLabel(type) {
  switch (type) {
    case 'rfid': return 'RFID';
    case 'nfc_phone': return 'NFC Phone';
    case 'ble_token': return 'BLE';
    default: return type || '—';
  }
}

function platformLabel(p) {
  switch ((p || '').toLowerCase()) {
    case 'ios': return '📱 iOS';
    case 'android': return '🤖 Android';
    case 'card': return '💳 Card';
    case 'other': return '• Other';
    default: return '—';
  }
}

function renderCheckins(rows) {
  const body = document.getElementById('checkinsBody');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6">No check-ins recorded.</td></tr>';
    return;
  }
  body.innerHTML = rows.map(r => `
    <tr>
      <td>${fmtDate(r.check_in_time)}</td>
      <td>${r.first_name ? `${r.first_name} ${r.last_name}` : 'Unknown'}</td>
      <td>${statusPill(r.status)}</td>
      <td>${r.entry_type_name || '—'}</td>
      <td>${credentialLabel(r.credential_type)} ${r.device_platform ? '· ' + platformLabel(r.device_platform) : ''}</td>
      <td>${statusPill(r.synced ? 'yes' : 'no')}</td>
    </tr>
  `).join('');
}

function renderCredentials(rows) {
  const body = document.getElementById('credsBody');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7">No credentials enrolled.</td></tr>';
    return;
  }
  body.innerHTML = rows.map(r => `
    <tr>
      <td>${r.first_name} ${r.last_name}</td>
      <td>${credentialLabel(r.credential_type)}</td>
      <td>${platformLabel(r.device_platform)}</td>
      <td>${r.device_name || '—'}</td>
      <td>${statusPill(r.status)}</td>
      <td>${fmtDate(r.enrolled_at)}</td>
      <td>${r.last_used_at ? fmtDate(r.last_used_at) : '—'}</td>
    </tr>
  `).join('');
}

function renderSyncLog(rows) {
  const body = document.getElementById('syncBody');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5">No sync log yet.</td></tr>';
    return;
  }
  body.innerHTML = rows.map(r => `
    <tr>
      <td>${fmtDate(r.sync_time)}</td>
      <td>${r.sync_type}</td>
      <td title="${r.error_message || ''}">${statusPill(r.status)}</td>
      <td>${r.records_pulled ?? 0}</td>
      <td>${r.records_pushed ?? 0}</td>
    </tr>
  `).join('');
}

function renderSchedules(rows) {
  const body = document.getElementById('schedulesBody');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6">No schedules found.</td></tr>';
    return;
  }
  body.innerHTML = rows.map(r => {
    const appliesTo = r.member_first_name
      ? `${r.member_first_name} ${r.member_last_name}`
      : (r.entry_type_name || '—');
    const dayOrDate = (r.schedule_type === 'one_time' || r.schedule_type === 'holiday')
      ? (r.specific_date || '—')
      : (r.days_of_week || '—');
    const time = r.schedule_type === 'unlimited'
      ? '24/7'
      : `${r.start_time || '—'} - ${r.end_time || '—'}`;
    return `
      <tr>
        <td>${r.name}</td>
        <td>${appliesTo}</td>
        <td>${r.schedule_type}</td>
        <td>${dayOrDate}</td>
        <td>${time}</td>
        <td>${statusPill(r.is_active ? 'active' : 'inactive')}</td>
      </tr>
    `;
  }).join('');
}

async function loadAll() {
  const status = document.getElementById('memberStatus').value;
  const q = document.getElementById('memberSearch').value.trim();
  const credType = document.getElementById('credType').value;
  const credPlatform = document.getElementById('credPlatform').value;

  const [summary, members, checkins, syncLog, schedules, credentials] = await Promise.all([
    getJson('/api/viewer/summary'),
    getJson(`/api/viewer/members?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}&limit=1000`),
    getJson('/api/viewer/checkins?limit=300'),
    getJson('/api/viewer/sync-log?limit=200'),
    getJson('/api/viewer/schedules?limit=2000'),
    getJson(`/api/viewer/credentials?type=${encodeURIComponent(credType)}&platform=${encodeURIComponent(credPlatform)}&limit=1000`)
  ]);

  renderSummary(summary);
  renderMembers(members);
  renderCheckins(checkins);
  renderSyncLog(syncLog);
  renderSchedules(schedules);
  renderCredentials(credentials);
}

document.getElementById('reloadMembers').addEventListener('click', loadAll);
document.getElementById('memberStatus').addEventListener('change', loadAll);
document.getElementById('memberSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadAll();
});
document.getElementById('reloadCreds').addEventListener('click', loadAll);
document.getElementById('credType').addEventListener('change', loadAll);
document.getElementById('credPlatform').addEventListener('change', loadAll);

loadAll().catch((err) => {
  console.error(err);
  alert('Failed to load GateEntry viewer data.');
});
