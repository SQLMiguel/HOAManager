const state = {
  scans: [],
  latestScan: null,
  eventSource: null,
  pollTimer: null,
  currentCardId: '',
  adminKey: ''
};

const elements = {
  connectionState: document.getElementById('connectionState'),
  latestCard: document.getElementById('latestCard'),
  latestStatus: document.getElementById('latestStatus'),
  latestTime: document.getElementById('latestTime'),
  latestMember: document.getElementById('latestMember'),
  latestReason: document.getElementById('latestReason'),
  latestCardId: document.getElementById('latestCardId'),
  latestCredential: document.getElementById('latestCredential'),
  latestResponse: document.getElementById('latestResponse'),
  scanList: document.getElementById('scanList'),
  scanCount: document.getElementById('scanCount'),
  copyCardBtn: document.getElementById('copyCardBtn'),
  refreshBtn: document.getElementById('refreshBtn')
};

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function formatTime(value) {
  if (!value) return 'No scans yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function formatDateTime(value) {
  if (!value) return 'No scans yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function memberName(scan) {
  if (scan && scan.member && scan.member.first_name) {
    return `${scan.member.first_name} ${scan.member.last_name || ''}`.trim();
  }
  if (scan && scan.status === 'unknown') return 'Unknown card';
  return 'No member matched';
}

function credentialLabel(scan) {
  const type = scan && scan.credential_type ? scan.credential_type : 'unknown';
  const platform = scan && scan.device_platform ? scan.device_platform : '';
  return platform ? `${type} / ${platform}` : type;
}

function statusClass(scan) {
  if (!scan) return 'waiting';
  if (scan.status === 'allowed') return 'allowed';
  if (scan.status === 'unknown') return 'unknown';
  return 'denied';
}

function statusLabel(scan) {
  if (!scan) return 'Waiting';
  if (scan.status === 'allowed') return 'Allowed';
  if (scan.status === 'unknown') return 'Unknown';
  return 'Denied';
}

function setConnection(status, text) {
  elements.connectionState.className = `connection ${status}`;
  elements.connectionState.textContent = text;
}

function setAdminKey(key) {
  state.adminKey = key || '';
  if (!state.adminKey) return;
  localStorage.setItem('gateAdminKey', state.adminKey);
  document.cookie = `gate_admin_key=${encodeURIComponent(state.adminKey)}; SameSite=Strict; path=/`;
}

function loadAdminKey() {
  const params = new URLSearchParams(window.location.search);
  setAdminKey(params.get('gate_key') || params.get('key') || localStorage.getItem('gateAdminKey') || '');
}

function requestAdminKey() {
  const key = window.prompt('Enter the GateEntry admin key for live scan monitoring:');
  if (!key) return false;
  setAdminKey(key.trim());
  return Boolean(state.adminKey);
}

function authHeaders() {
  return state.adminKey ? { 'X-Gate-Viewer-Key': state.adminKey } : {};
}

function renderLatest(scan) {
  const status = statusClass(scan);
  state.latestScan = scan || null;
  state.currentCardId = scan && scan.card_id ? scan.card_id : '';

  elements.latestCard.className = `hero-card ${status}`;
  elements.latestStatus.className = `result-pill result-${status}`;
  elements.latestStatus.textContent = statusLabel(scan);
  elements.latestTime.textContent = scan ? formatDateTime(scan.scanned_at) : 'No scans yet';
  elements.latestMember.textContent = scan ? memberName(scan) : 'Ready for the next scan';
  elements.latestReason.textContent = scan && scan.reason ? scan.reason : 'Keep this tablet on the same Wi-Fi as the Raspberry Pi.';
  elements.latestCardId.textContent = state.currentCardId || 'Not available';
  elements.latestCredential.textContent = scan ? credentialLabel(scan) : 'Unknown';
  elements.latestResponse.textContent = scan && scan.response_ms != null ? `${scan.response_ms} ms` : '--';
  elements.copyCardBtn.disabled = !state.currentCardId;
}

function renderList(scans) {
  const rows = scans || [];
  elements.scanCount.textContent = `${rows.length} shown`;
  if (!rows.length) {
    elements.scanList.innerHTML = '<article class="empty-state">No scans yet. The newest scan will appear here instantly.</article>';
    return;
  }

  elements.scanList.innerHTML = rows.map(scan => {
    const status = statusClass(scan);
    const cardId = scan.card_id ? `Card ${escapeHtml(scan.card_id)}` : 'No card ID shown';
    const reason = scan.reason ? escapeHtml(scan.reason) : 'No reason provided';
    return `
      <article class="scan-row ${status}">
        <div class="scan-row-top">
          <div class="scan-row-name">${escapeHtml(memberName(scan))}</div>
          <span class="result-pill result-${status}">${escapeHtml(statusLabel(scan))}</span>
        </div>
        <div class="scan-meta">${escapeHtml(formatTime(scan.scanned_at))} - ${reason}</div>
        <div class="scan-meta">${cardId} - ${escapeHtml(credentialLabel(scan))}</div>
      </article>
    `;
  }).join('');
}

function mergeScans(incoming) {
  const byId = new Map();
  for (const scan of incoming || []) byId.set(scan.id, scan);
  for (const scan of state.scans) byId.set(scan.id, scan);
  state.scans = Array.from(byId.values())
    .sort((a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime())
    .slice(0, 30);
}

async function loadSnapshot(allowPrompt = true) {
  let response = await fetch('/api/viewer/live-scans?limit=30', { headers: authHeaders() });
  if (response.status === 401 && allowPrompt && requestAdminKey()) {
    response = await fetch('/api/viewer/live-scans?limit=30', { headers: authHeaders() });
  }
  if (response.status === 401) {
    setConnection('offline', 'Key required');
    throw new Error('Unauthorized');
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  mergeScans(data.scans || []);
  renderLatest(data.latestScan || state.scans[0] || null);
  renderList(state.scans);
}

function addScan(scan) {
  if (!scan || !scan.id) return;
  state.scans = [scan, ...state.scans.filter(item => item.id !== scan.id)].slice(0, 30);
  renderLatest(scan);
  renderList(state.scans);
}

function startPollingFallback() {
  if (state.pollTimer) return;
  state.pollTimer = setInterval(() => {
    loadSnapshot()
      .then(() => setConnection('online', 'Polling'))
      .catch(() => setConnection('offline', 'Offline'));
  }, 5000);
}

function connectEvents() {
  if (!window.EventSource) {
    startPollingFallback();
    return;
  }

  if (state.eventSource) state.eventSource.close();
  const events = new EventSource('/api/viewer/events');
  state.eventSource = events;

  events.addEventListener('ready', event => {
    setConnection('online', 'Live');
    const data = JSON.parse(event.data || '{}');
    mergeScans(data.scans || []);
    renderLatest(data.latestScan || state.scans[0] || null);
    renderList(state.scans);
  });

  events.addEventListener('scan', event => {
    setConnection('online', 'Live');
    addScan(JSON.parse(event.data));
  });

  events.onerror = () => {
    setConnection('offline', 'Reconnecting');
  };
}

elements.copyCardBtn.addEventListener('click', async () => {
  if (!state.currentCardId) return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(state.currentCardId);
      elements.latestReason.textContent = `Copied card ID ${state.currentCardId}`;
      return;
    }
  } catch (_) {
    // Fall through to manual copy guidance.
  }
  elements.latestReason.textContent = `Card ID: ${state.currentCardId}`;
});

elements.refreshBtn.addEventListener('click', () => {
  loadSnapshot()
    .then(() => setConnection('online', state.eventSource ? 'Live' : 'Polling'))
    .catch(() => setConnection('offline', 'Offline'));
});

loadAdminKey();

loadSnapshot()
  .then(() => connectEvents())
  .catch((err) => {
    setConnection('offline', 'Offline');
    if (err && err.message === 'Unauthorized') return;
    connectEvents();
  });
