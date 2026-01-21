# sbtlTV TMDB Cache

Daily cache of TMDB trending and popular lists for [sbtlTV](https://github.com/thesubtleties/sbtlTV).

## Purpose

This repository provides a fallback data source for sbtlTV users who don't have their own TMDB API key. A GitHub Action runs daily to fetch the latest trending and popular movies/TV shows from TMDB and commits them to this repo.

## Available Lists

### Movies
- `trending_day` - Trending movies (last 24 hours)
- `trending_week` - Trending movies (last 7 days)
- `popular` - Currently popular movies
- `top_rated` - Highest rated movies
- `now_playing` - Currently in theaters
- `upcoming` - Coming soon to theaters
- `genres` - Movie genre list

### TV Shows
- `trending_day` - Trending shows (last 24 hours)
- `trending_week` - Trending shows (last 7 days)
- `popular` - Currently popular shows
- `top_rated` - Highest rated shows
- `on_the_air` - Currently airing shows
- `airing_today` - Episodes airing today
- `genres` - TV genre list

## Usage

The cache file is available at:
```
https://raw.githubusercontent.com/thesubtleties/sbtlTV-tmdb-cache/main/data/tmdb-cache.json
```

## Setup (for maintainers)

1. Add `TMDB_ACCESS_TOKEN` as a repository secret (this is the "API Read Access Token" from TMDB, not the API key)
2. The GitHub Action will run daily at 6 AM UTC
3. You can also trigger it manually from the Actions tab

## License

Data sourced from [TMDB](https://www.themoviedb.org/). This product uses the TMDB API but is not endorsed or certified by TMDB.
