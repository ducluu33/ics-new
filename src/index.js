import fs from 'node:fs/promises';
import { exportIcs } from './scraper.js';

async function main() {
  console.log('[index] Starting ICS export...');
  const result = await exportIcs();
  const content = await fs.readFile(result.outputPath, 'utf8');
  const eventCount = (content.match(/BEGIN:VEVENT/g) || []).length;
  console.log(`[index] ✓ ${result.outputPath}: ${result.size} bytes, ${eventCount} events`);
  if (eventCount === 0) {
    console.warn('[index] WARNING: 0 events in exported ICS — site returned empty file');
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
