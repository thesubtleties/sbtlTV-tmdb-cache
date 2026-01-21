/**
 * Fetch TMDB lists and save to cache file
 *
 * This script fetches various movie and TV lists from TMDB API
 * and saves them to a JSON file that can be used as a fallback
 * for users without their own API key.
 */

const fs = require('fs');
const path = require('path');

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const BASE_URL = 'https://api.themoviedb.org/3';
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'tmdb-cache.json');

if (!TMDB_API_KEY) {
  console.error('Error: TMDB_API_KEY environment variable is required');
  process.exit(1);
}

async function fetchTmdb(endpoint) {
  const url = `${BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}api_key=${TMDB_API_KEY}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`TMDB API error: ${response.status} for ${endpoint}`);
  }

  return response.json();
}

async function fetchAllPages(endpoint, maxPages = 3) {
  const results = [];

  for (let page = 1; page <= maxPages; page++) {
    const separator = endpoint.includes('?') ? '&' : '?';
    const data = await fetchTmdb(`${endpoint}${separator}page=${page}`);
    results.push(...(data.results || []));

    // Stop if we've reached the last page
    if (page >= data.total_pages) break;

    // Small delay to be nice to the API
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  return results;
}

async function main() {
  console.log('Fetching TMDB data...');

  const cache = {
    generated_at: new Date().toISOString(),
    movies: {},
    tv: {}
  };

  try {
    // =========== MOVIES ===========
    console.log('Fetching movie lists...');

    // Trending movies (day and week)
    cache.movies.trending_day = await fetchAllPages('/trending/movie/day', 2);
    console.log(`  - Trending (day): ${cache.movies.trending_day.length} movies`);

    cache.movies.trending_week = await fetchAllPages('/trending/movie/week', 2);
    console.log(`  - Trending (week): ${cache.movies.trending_week.length} movies`);

    // Popular movies
    cache.movies.popular = await fetchAllPages('/movie/popular', 3);
    console.log(`  - Popular: ${cache.movies.popular.length} movies`);

    // Top rated movies
    cache.movies.top_rated = await fetchAllPages('/movie/top_rated', 2);
    console.log(`  - Top rated: ${cache.movies.top_rated.length} movies`);

    // Now playing
    cache.movies.now_playing = await fetchAllPages('/movie/now_playing', 2);
    console.log(`  - Now playing: ${cache.movies.now_playing.length} movies`);

    // Upcoming
    cache.movies.upcoming = await fetchAllPages('/movie/upcoming', 2);
    console.log(`  - Upcoming: ${cache.movies.upcoming.length} movies`);

    // Movie genres
    const movieGenresData = await fetchTmdb('/genre/movie/list');
    cache.movies.genres = movieGenresData.genres || [];
    console.log(`  - Genres: ${cache.movies.genres.length}`);

    // =========== TV SHOWS ===========
    console.log('Fetching TV lists...');

    // Trending TV (day and week)
    cache.tv.trending_day = await fetchAllPages('/trending/tv/day', 2);
    console.log(`  - Trending (day): ${cache.tv.trending_day.length} shows`);

    cache.tv.trending_week = await fetchAllPages('/trending/tv/week', 2);
    console.log(`  - Trending (week): ${cache.tv.trending_week.length} shows`);

    // Popular TV
    cache.tv.popular = await fetchAllPages('/tv/popular', 3);
    console.log(`  - Popular: ${cache.tv.popular.length} shows`);

    // Top rated TV
    cache.tv.top_rated = await fetchAllPages('/tv/top_rated', 2);
    console.log(`  - Top rated: ${cache.tv.top_rated.length} shows`);

    // On the air
    cache.tv.on_the_air = await fetchAllPages('/tv/on_the_air', 2);
    console.log(`  - On the air: ${cache.tv.on_the_air.length} shows`);

    // Airing today
    cache.tv.airing_today = await fetchAllPages('/tv/airing_today', 2);
    console.log(`  - Airing today: ${cache.tv.airing_today.length} shows`);

    // TV genres
    const tvGenresData = await fetchTmdb('/genre/tv/list');
    cache.tv.genres = tvGenresData.genres || [];
    console.log(`  - Genres: ${cache.tv.genres.length}`);

    // =========== SAVE ===========
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(cache, null, 2));
    console.log(`\nCache saved to ${OUTPUT_FILE}`);

    // Print summary
    const movieCount = Object.values(cache.movies).reduce((sum, arr) =>
      sum + (Array.isArray(arr) ? arr.length : 0), 0);
    const tvCount = Object.values(cache.tv).reduce((sum, arr) =>
      sum + (Array.isArray(arr) ? arr.length : 0), 0);
    console.log(`Total: ${movieCount} movie entries, ${tvCount} TV entries`);

  } catch (error) {
    console.error('Error fetching TMDB data:', error.message);
    process.exit(1);
  }
}

main();
