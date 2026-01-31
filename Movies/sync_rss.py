#!/usr/bin/env python3
"""
Sync Letterboxd RSS feed with local movie data.

Fetches the RSS feed, extracts new entries, and merges them
with the existing reviews.csv file.

Usage: python sync_rss.py
"""

import csv
import re
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from datetime import datetime

# Configuration
RSS_URL = "https://letterboxd.com/THEORANGEBLUR/rss/"
SCRIPT_DIR = Path(__file__).parent
SRC_DIR = SCRIPT_DIR / "src"
REVIEWS_FILE = SRC_DIR / "reviews.csv"

# RSS namespaces
NAMESPACES = {
    'letterboxd': 'https://letterboxd.com',
    'tmdb': 'https://themoviedb.org',
    'dc': 'http://purl.org/dc/elements/1.1/',
}


def fetch_rss() -> str:
    """Fetch RSS feed content."""
    print(f"Fetching RSS feed from {RSS_URL}...")
    req = urllib.request.Request(RSS_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read().decode('utf-8')


def parse_rss(xml_content: str) -> list:
    """Parse RSS feed and extract movie entries."""
    # Register namespaces
    for prefix, uri in NAMESPACES.items():
        ET.register_namespace(prefix, uri)

    root = ET.fromstring(xml_content)
    channel = root.find('channel')
    if channel is None:
        print("  Warning: No channel found in RSS feed")
        return []

    movies = []
    for item in channel.findall('item'):
        # Extract basic info
        title_elem = item.find('title')
        link_elem = item.find('link')
        pub_date_elem = item.find('pubDate')
        description_elem = item.find('description')

        # Extract Letterboxd-specific fields
        film_title = item.find('letterboxd:filmTitle', NAMESPACES)
        film_year = item.find('letterboxd:filmYear', NAMESPACES)
        watched_date = item.find('letterboxd:watchedDate', NAMESPACES)
        member_rating = item.find('letterboxd:memberRating', NAMESPACES)
        rewatch = item.find('letterboxd:rewatch', NAMESPACES)

        if film_title is None:
            continue

        # Parse the description for review text
        review_text = ""
        if description_elem is not None and description_elem.text:
            # The description contains HTML - extract text after the image
            desc = description_elem.text
            # Remove HTML tags to get clean review text
            # The format is typically: <p><img .../></p><p>Watched on DATE</p><p>Review text...</p>
            # Let's extract review paragraphs after "Watched on" line
            parts = re.split(r'<p>Watched on [^<]+</p>', desc, maxsplit=1)
            if len(parts) > 1:
                review_html = parts[1]
                # Remove HTML tags
                review_text = re.sub(r'<[^>]+>', '', review_html).strip()

        movie = {
            'Date': datetime.now().strftime('%Y-%m-%d'),  # When synced
            'Name': film_title.text if film_title is not None else '',
            'Year': film_year.text if film_year is not None else '',
            'Letterboxd URI': link_elem.text if link_elem is not None else '',
            'Rating': member_rating.text if member_rating is not None else '',
            'Rewatch': 'Yes' if rewatch is not None and rewatch.text == 'Yes' else '',
            'Review': review_text,
            'Tags': '',
            'Watched Date': watched_date.text if watched_date is not None else '',
        }
        movies.append(movie)

    return movies


def load_existing_movies(csv_path: Path) -> dict:
    """Load existing movies from CSV, keyed by (name, watched_date)."""
    existing = {}
    if not csv_path.exists():
        return existing

    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            key = (row.get('Name', ''), row.get('Watched Date', ''))
            existing[key] = row

    return existing


def merge_movies(existing: dict, new_movies: list) -> tuple:
    """Merge new movies with existing, returning (merged_list, added_count)."""
    added = 0
    merged = dict(existing)

    for movie in new_movies:
        key = (movie['Name'], movie['Watched Date'])
        if key not in merged:
            merged[key] = movie
            added += 1
            print(f"  + {movie['Name']} ({movie['Year']}) - {movie['Watched Date']}")

    # Convert back to list and sort by watched date (newest first)
    result = list(merged.values())
    result.sort(key=lambda m: m.get('Watched Date', ''), reverse=True)

    return result, added


def save_movies(movies: list, csv_path: Path):
    """Save movies to CSV file."""
    if not movies:
        return

    fieldnames = ['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating', 'Rewatch', 'Review', 'Tags', 'Watched Date']

    with open(csv_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for movie in movies:
            # Ensure all fields exist
            row = {field: movie.get(field, '') for field in fieldnames}
            writer.writerow(row)


def main():
    """Main entry point."""
    print("=" * 50)
    print("Letterboxd RSS Sync")
    print("=" * 50)

    # Fetch RSS feed
    try:
        xml_content = fetch_rss()
        print(f"  Fetched {len(xml_content)} bytes")
    except Exception as e:
        print(f"  ERROR: Failed to fetch RSS feed: {e}")
        return 1

    # Parse RSS feed
    print("\nParsing RSS feed...")
    new_movies = parse_rss(xml_content)
    print(f"  Found {len(new_movies)} movies in feed")

    # Load existing movies
    print(f"\nLoading existing data from {REVIEWS_FILE.name}...")
    existing = load_existing_movies(REVIEWS_FILE)
    print(f"  Found {len(existing)} existing entries")

    # Merge
    print("\nMerging new entries...")
    merged, added_count = merge_movies(existing, new_movies)

    if added_count == 0:
        print("  No new movies to add")
        print("\n" + "=" * 50)
        print("Sync complete - no changes")
        print("=" * 50)
        return 0

    # Save
    print(f"\nSaving {len(merged)} movies to {REVIEWS_FILE.name}...")
    save_movies(merged, REVIEWS_FILE)

    print("\n" + "=" * 50)
    print(f"Sync complete - added {added_count} new movie(s)")
    print("=" * 50)

    return 0


if __name__ == '__main__':
    exit(main())
