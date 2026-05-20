// Standalone RFID card ID reader app.
// Runs on the Raspberry Pi, listens to the configured reader backend, and shows
// scanned IDs in a small local web page. It does not open the gate, write to the
// database, or sync with the HOA website.

const express = require('express');
const config = require('./config');
const rfid = require('./rfid');

const app = express();
const scans = [];
const clients = new Set();
const maxScans = 100;
let latestScan = null;
let poller = null;
let startedAt = new Date();

function normalizeTagForDisplay(tagId) {
  return String(tagId || '').trim();
}

function addScan(tagId) {
  const cleanTag = normalizeTagForDisplay(tagId);
  if (!cleanTag) return;

  const scan = {
    tagId: cleanTag,
    scannedAt: new Date().toISOString()
  };

  latestScan = scan;
  scans.unshift(scan);
  if (scans.length > maxScans) scans.pop();

  console.log(`[CARD] ${scan.scannedAt} ${scan.tagId}`);
  broadcast({ type: 'scan', scan });
}

function broadcast(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    res.write(data);
  }
}

function html() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GateEntry Card ID Reader</title>
  <style>
    :root { color-scheme: light dark; font-family: Arial, Helvetica, sans-serif; }
    body { margin: 0; background: #f4f6f8; color: #17202a; }
    header { background: #183b56; color: #fff; padding: 24px; }
    header h1 { margin: 0 0 6px; font-size: 28px; }
    header p { margin: 0; opacity: 0.86; }
    main { max-width: 960px; margin: 24px auto; padding: 0 16px; }
    .card { background: #fff; border: 1px solid #d8e0e8; border-radius: 12px; box-shadow: 0 6px 18px rgba(23,32,42,0.08); padding: 20px; margin-bottom: 18px; }
    .latest { display: grid; gap: 12px; }
    .tag { font-family: Consolas, Monaco, monospace; font-size: clamp(30px, 7vw, 64px); font-weight: 700; overflow-wrap: anywhere; }
    .muted { color: #5f6f7f; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; }
    button { border: 0; border-radius: 8px; padding: 10px 14px; background: #0b6bcb; color: #fff; cursor: pointer; font-weight: 700; }
    button.secondary { background: #d9e2ec; color: #183b56; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #e5ebf0; padding: 10px; text-align: left; }
    th { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: #5f6f7f; }
    .status { display: inline-block; border-radius: 999px; background: #e3fcef; color: #0f5132; padding: 4px 10px; font-size: 13px; font-weight: 700; }
    @media (prefers-color-scheme: dark) {
      body { background: #101820; color: #edf2f7; }
      .card { background: #182634; border-color: #2d4053; }
      .muted, th { color: #a8b3bf; }
      td, th { border-bottom-color: #2d4053; }
      button.secondary { background: #2d4053; color: #edf2f7; }
    }
  </style>
</head>
<body>
  <header>
    <h1>GateEntry Card ID Reader</h1>
    <p>Scan a card or fob to capture the ID for the HOA admin panel.</p>
  </header>
  <main>
    <section class="card latest">
      <div><span class="status" id="status">Listening</span></div>
      <div class="muted">Latest card ID</div>
      <div class="tag" id="latestTag">Waiting for scan...</div>
      <div class="muted" id="latestTime">Hold a card near the reader.</div>
      <div class="actions">
        <button id="copyBtn" type="button">Copy latest ID</button>
        <button id="clearBtn" class="secondary" type="button">Clear screen</button>
      </div>
    </section>

    <section class="card">
      <h2>Recent scans</h2>
      <table>
        <thead><tr><th>Time</th><th>Card ID</th></tr></thead>
        <tbody id="scanRows"><tr><td colspan="2" class="muted">No scans yet.</td></tr></tbody>
      </table>
    </section>

    <section class="card">
      <h2>How to use this ID</h2>
      <ol>
        <li>Scan the card here.</li>
        <li>Copy the latest ID.</li>
        <li>Open the HOA website admin panel.</li>
        <li>Edit the pool member and paste the ID into the RFID Tag field.</li>
        <li>Save, then run a GateEntry sync if you need it active immediately.</li>
      </ol>
    </section>
  </main>
  <script>
    const latestTag = document.getElementById('latestTag');
    const latestTime = document.getElementById('latestTime');
    const scanRows = document.getElementById('scanRows');
    const status = document.getElementById('status');
    let currentTag = '';

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char]));
    }

    function renderScans(scans) {
      if (!scans.length) {
        scanRows.innerHTML = '<tr><td colspan="2" class="muted">No scans yet.</td></tr>';
        return;
      }
      scanRows.innerHTML = scans.map(scan => {
        const time = new Date(scan.scannedAt).toLocaleString();
        return '<tr><td>' + escapeHtml(time) + '</td><td><strong>' + escapeHtml(scan.tagId) + '</strong></td></tr>';
      }).join('');
    }

    function setLatest(scan) {
      if (!scan) return;
      currentTag = scan.tagId;
      latestTag.textContent = scan.tagId;
      latestTime.textContent = 'Scanned at ' + new Date(scan.scannedAt).toLocaleString();
    }

    fetch('/api/scans')
      .then(res => res.json())
      .then(data => {
        renderScans(data.scans || []);
        setLatest(data.latestScan);
      })
      .catch(() => { status.textContent = 'Load error'; });

    const events = new EventSource('/api/events');
    events.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.type === 'ready') status.textContent = 'Listening';
      if (message.type === 'scan') {
        setLatest(message.scan);
        fetch('/api/scans').then(res => res.json()).then(data => renderScans(data.scans || []));
      }
    };
    events.onerror = () => { status.textContent = 'Reconnecting'; };

    document.getElementById('copyBtn').addEventListener('click', async () => {
      if (!currentTag) return;
      await navigator.clipboard.writeText(currentTag);
      latestTime.textContent = 'Copied ' + currentTag;
    });

    document.getElementById('clearBtn').addEventListener('click', () => {
      latestTag.textContent = 'Waiting for scan...';
      latestTime.textContent = 'Hold a card near the reader.';
      currentTag = '';
    });
  </script>
</body>
</html>`;
}

app.get('/', (_req, res) => {
  res.type('html').send(html());
});

app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    startedAt: startedAt.toISOString(),
    simulationMode: rfid.isSimulationMode(),
    latestScan
  });
});

app.get('/api/scans', (_req, res) => {
  res.json({ latestScan, scans });
});

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.write(`data: ${JSON.stringify({ type: 'ready' })}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

function closePoller() {
  if (!poller) return;
  if (typeof poller.close === 'function') {
    poller.close();
  } else {
    clearInterval(poller);
  }
}

function shutdown() {
  console.log('\nStopping card ID reader app...');
  closePoller();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function start() {
  startedAt = new Date();
  rfid.init();
  poller = rfid.startPolling(addScan, 1500);

  app.listen(config.cardReaderPort, config.cardReaderHost, () => {
    console.log('');
    console.log('GateEntry card ID reader app is running.');
    console.log(`Open http://<pi-ip>:${config.cardReaderPort}`);
    console.log('Scan a card to display and copy its ID.');
    if (rfid.isSimulationMode()) {
      console.log('Simulation mode is active. Type a card ID here and press Enter.');
    }
    console.log('');
  });
}

start();