// ─── Database Setup Script ──────────────────────────────
// Run this once to initialize the local database and perform
// the first sync from the website.
//
// Usage: node src/setup-db.js

const config = require('./config');
const db = require('./database');
const sync = require('./sync');

async function setup() {
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  Gate Entry — Database Setup');
  console.log('═══════════════════════════════════════════');
  console.log('');
  console.log('  DB path:', config.dbPath);
  console.log('  Website:', config.websiteUrl);
  console.log('');

  // Initialize local database
  db.initDb();

  // Pull initial data from website
  console.log('  Performing initial sync...');
  try {
    const result = await sync.runSync();
    console.log('');
    console.log('  ✓ Setup complete! Database is ready.');
    console.log('  Run "npm start" to begin gate operation.');
  } catch (e) {
    console.error('');
    console.error('  ✗ Initial sync failed:', e.message);
    console.error('  The database is created but empty.');
    console.error('  Ensure the website is running and GATE_API_KEY is correct.');
    console.error('  You can retry with: npm run sync');
  }

  db.close();
  console.log('');
}

setup();
