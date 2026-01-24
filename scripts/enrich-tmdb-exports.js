/**
 * Enrich TMDB Daily Exports with Year Data
 *
 * Downloads the TMDB daily movie/TV exports and enriches them with release year.
 * Uses incremental updates - only fetches details for IDs not already in our enriched data.
 * Saves checkpoints every 50k entries to avoid losing progress on timeout.
 *
 * Output format (compact):
 * Movies: { i: id, t: title, y: year, p: popularity }
 * TV:     { i: id, t: name, y: year, p: popularity }
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TMDB_ACCESS_TOKEN = process.env.TMDB_ACCESS_TOKEN;
const BASE_URL = 'https://api.themoviedb.org/3';
const DATA_DIR = path.join(__dirname, '..', 'data');

// Rate limiting: TMDB allows 50 req/sec, we'll be conservative
const REQUESTS_PER_SECOND = 40;
const BATCH_SIZE = 100;
const CHECKPOINT_INTERVAL = 50000; // Save every 50k entries
const MAX_RUNTIME_MS = 5.5 * 60 * 60 * 1000; // 5.5 hours (leave 30min for commit)
const START_TIME = Date.now();

if (!TMDB_ACCESS_TOKEN) {
  console.error('Error: TMDB_ACCESS_TOKEN environment variable is required');
  process.exit(1);
}

// ===========================================================================
// Helpers
// ===========================================================================

function getExportDate() {
  // Use yesterday's date (exports are generated overnight)
  const now = new Date();
  now.setDate(now.getDate() - 1);
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const year = now.getFullYear();
  return `${month}_${day}_${year}`;
}

function buildExportUrl(type) {
  const date = getExportDate();
  const fileType = type === 'movie' ? 'movie_ids' : 'tv_series_ids';
  return `https://files.tmdb.org/p/exports/${fileType}_${date}.json.gz`;
}

async function fetchTmdb(endpoint) {
  const url = `${BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${TMDB_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`TMDB API error: ${response.status} for ${endpoint}`);
  }

  return response.json();
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===========================================================================
// Download and Parse Export
// ===========================================================================

async function downloadExport(type) {
  const url = buildExportUrl(type);
  console.log(`Downloading ${type} export from ${url}...`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download export: ${response.status}`);
  }

  const gzippedData = await response.arrayBuffer();
  const decompressed = zlib.gunzipSync(Buffer.from(gzippedData));
  const lines = decompressed.toString('utf-8').split('\n');

  const entries = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (!entry.adult) {
        entries.push({
          id: entry.id,
          title: type === 'movie' ? entry.original_title : entry.original_name,
          popularity: entry.popularity || 0,
        });
      }
    } catch {
      // Skip malformed lines
    }
  }

  console.log(`  Parsed ${entries.length} ${type} entries`);
  return entries;
}

// ===========================================================================
// Load/Save Enriched Data
// ===========================================================================

function loadEnrichedData(type) {
  const filePath = path.join(DATA_DIR, `tmdb-${type}s-enriched.json`);
  if (!fs.existsSync(filePath)) {
    return new Map();
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const map = new Map();
  for (const entry of data.entries) {
    map.set(entry.i, entry);
  }
  console.log(`  Loaded ${map.size} existing enriched ${type} entries`);
  return map;
}

function saveEnrichedData(type, enrichedMap, isCheckpoint = false) {
  const filePath = path.join(DATA_DIR, `tmdb-${type}s-enriched.json`);

  // Convert map to sorted array (by popularity desc for better compression)
  const entries = Array.from(enrichedMap.values())
    .sort((a, b) => b.p - a.p);

  const data = {
    generated_at: new Date().toISOString(),
    count: entries.length,
    entries,
  };

  fs.writeFileSync(filePath, JSON.stringify(data));

  if (isCheckpoint) {
    console.log(`    [Checkpoint] Saved ${entries.length} ${type} entries`);
  } else {
    console.log(`  Saved ${entries.length} enriched ${type} entries to ${filePath}`);
    // Only create gzipped version on final save
    const gzipped = zlib.gzipSync(JSON.stringify(data));
    fs.writeFileSync(filePath + '.gz', gzipped);
    console.log(`  Gzipped size: ${(gzipped.length / 1024 / 1024).toFixed(2)} MB`);
  }
}

// ===========================================================================
// Fetch Details for New IDs (with checkpointing)
// ===========================================================================

async function fetchDetailsForIds(type, ids, enrichedMap) {
  console.log(`  Fetching details for ${ids.length} new ${type} IDs...`);

  const endpoint = type === 'movie' ? 'movie' : 'tv';
  let completed = 0;
  let errors = 0;
  let lastCheckpoint = 0;

  // Process in batches with rate limiting
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const batchStartTime = Date.now();

    const promises = batch.map(async (id) => {
      try {
        const details = await fetchTmdb(`/${endpoint}/${id}`);
        if (details) {
          const year = type === 'movie'
            ? details.release_date?.slice(0, 4)
            : details.first_air_date?.slice(0, 4);

          return {
            i: details.id,
            t: type === 'movie' ? details.title : details.name,
            y: year ? parseInt(year) : null,
            p: Math.round((details.popularity || 0) * 100) / 100,
          };
        }
      } catch (err) {
        errors++;
      }
      return null;
    });

    const batchResults = await Promise.all(promises);

    // Add results directly to enrichedMap
    for (const result of batchResults) {
      if (result) {
        enrichedMap.set(result.i, result);
      }
    }

    completed += batch.length;

    // Rate limiting - ensure we don't exceed REQUESTS_PER_SECOND
    const elapsed = Date.now() - batchStartTime;
    const minTime = (batch.length / REQUESTS_PER_SECOND) * 1000;
    if (elapsed < minTime) {
      await sleep(minTime - elapsed);
    }

    // Progress logging
    if (completed % 1000 === 0 || completed === ids.length) {
      const pct = ((completed / ids.length) * 100).toFixed(1);
      console.log(`    Progress: ${completed}/${ids.length} (${pct}%) - ${errors} errors`);
    }

    // Checkpoint every CHECKPOINT_INTERVAL entries
    if (completed - lastCheckpoint >= CHECKPOINT_INTERVAL) {
      saveEnrichedData(type, enrichedMap, true);
      lastCheckpoint = completed;
    }

    // Check if we're running out of time (exit gracefully before GitHub kills us)
    if (Date.now() - START_TIME > MAX_RUNTIME_MS) {
      console.log(`\n⏰ Approaching time limit - saving progress and exiting gracefully`);
      saveEnrichedData(type, enrichedMap, true);
      console.log(`  Completed ${completed}/${ids.length} (${((completed/ids.length)*100).toFixed(1)}%)`);
      console.log(`  Re-run workflow to continue from checkpoint`);
      process.exit(0); // Clean exit so commit step runs
    }
  }

  console.log(`  Fetched details for ${completed} IDs (${errors} errors)`);
}

// ===========================================================================
// Main
// ===========================================================================

async function enrichType(type) {
  console.log(`\n=== Enriching ${type}s ===`);

  // 1. Download current export
  const exportEntries = await downloadExport(type);
  const exportIds = new Set(exportEntries.map(e => e.id));

  // 2. Load existing enriched data
  const enrichedMap = loadEnrichedData(type);

  // 3. Find new IDs (in export but not in enriched)
  const newIds = [];
  for (const id of exportIds) {
    if (!enrichedMap.has(id)) {
      newIds.push(id);
    }
  }
  console.log(`  Found ${newIds.length} new IDs to fetch`);

  // 4. Find stale IDs (in enriched but not in export - removed from TMDB)
  let staleCount = 0;
  for (const id of enrichedMap.keys()) {
    if (!exportIds.has(id)) {
      enrichedMap.delete(id);
      staleCount++;
    }
  }
  if (staleCount > 0) {
    console.log(`  Removed ${staleCount} stale IDs`);
  }

  // 5. Fetch details for new IDs (with checkpointing)
  if (newIds.length > 0) {
    await fetchDetailsForIds(type, newIds, enrichedMap);
  }

  // 6. Update popularity for existing entries from export
  for (const entry of exportEntries) {
    const existing = enrichedMap.get(entry.id);
    if (existing) {
      existing.p = Math.round((entry.popularity || 0) * 100) / 100;
    }
  }

  // 7. Final save
  saveEnrichedData(type, enrichedMap, false);

  return {
    total: enrichedMap.size,
    new: newIds.length,
    stale: staleCount,
  };
}

async function main() {
  console.log('TMDB Export Enrichment');
  console.log('======================');
  console.log(`Date: ${new Date().toISOString()}`);

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  try {
    const movieStats = await enrichType('movie');
    const tvStats = await enrichType('tv');

    console.log('\n=== Summary ===');
    console.log(`Movies: ${movieStats.total} total, ${movieStats.new} new, ${movieStats.stale} removed`);
    console.log(`TV:     ${tvStats.total} total, ${tvStats.new} new, ${tvStats.stale} removed`);
    console.log('\nDone!');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
