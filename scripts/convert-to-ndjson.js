/**
 * Convert existing enriched JSON files to NDJSON format
 * One-time migration script - run locally, then commit the new files
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DATA_DIR = path.join(__dirname, '..', 'data');

function convert(type) {
  const jsonPath = path.join(DATA_DIR, `tmdb-${type}s-enriched.json`);
  const ndjsonPath = path.join(DATA_DIR, `tmdb-${type}s-enriched.ndjson`);

  if (!fs.existsSync(jsonPath)) {
    console.log(`Skipping ${type}: ${jsonPath} not found`);
    return;
  }

  console.log(`Converting ${type}...`);

  // Load existing JSON
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  console.log(`  Loaded ${data.count} entries from JSON`);

  // Convert to NDJSON
  const ndjson = data.entries.map(e => JSON.stringify(e)).join('\n');
  fs.writeFileSync(ndjsonPath, ndjson);
  console.log(`  Wrote NDJSON: ${(ndjson.length / 1024 / 1024).toFixed(2)} MB`);

  // Create gzipped version
  const gzipped = zlib.gzipSync(ndjson);
  fs.writeFileSync(ndjsonPath + '.gz', gzipped);
  console.log(`  Wrote gzipped: ${(gzipped.length / 1024 / 1024).toFixed(2)} MB`);
}

convert('movie');
convert('tv');
console.log('\nDone! You can now commit the .ndjson and .ndjson.gz files.');
