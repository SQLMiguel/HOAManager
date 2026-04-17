// ─── RFID Test Script ───────────────────────────────────
// Tests RFID reader hardware. Run on the Raspberry Pi to verify
// the MFRC522 module is wired correctly and reading tags.
//
// Usage: node src/test-rfid.js

const rfid = require('./rfid');

console.log('');
console.log('═══════════════════════════════════════════');
console.log('  RFID Reader Test');
console.log('═══════════════════════════════════════════');
console.log('');

rfid.init();

console.log('  Hold an RFID tag near the reader...');
console.log('  Press Ctrl+C to stop.\n');

const poller = rfid.startPolling((tagId) => {
  console.log(`  ✓ Tag detected: ${tagId}`);
  console.log('    (hold another tag or press Ctrl+C to stop)\n');
}, 2000);

process.on('SIGINT', () => {
  console.log('\n  Test complete.');
  if (poller && typeof poller.close === 'function') {
    poller.close();
  } else if (poller) {
    clearInterval(poller);
  }
  process.exit(0);
});
