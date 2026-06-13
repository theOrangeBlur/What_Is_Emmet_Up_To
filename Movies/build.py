#!/usr/bin/env python3
"""
Static site generator for Emmet's Movie Reviews page.

Usage: python build.py
Reads: src/reviews.csv (Letterboxd export), src/profile.csv
Outputs: movies.html
"""

import csv
import json
import re
import urllib.request
import urllib.parse
from pathlib import Path
from datetime import datetime
import time

# Paths
SCRIPT_DIR = Path(__file__).parent
SRC_DIR = SCRIPT_DIR / "src"
REVIEWS_FILE = SRC_DIR / "reviews.csv"
PROFILE_FILE = SRC_DIR / "profile.csv"
TEMPLATE_FILE = SRC_DIR / "template.html"
OUTPUT_FILE = SCRIPT_DIR / "movies.html"
POSTER_CACHE_FILE = SRC_DIR / "poster_cache.json"

# TMDb API configuration
TMDB_API_KEY = "09467dd3705826fcd6d8d1aff39ee1cf"
TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w300"

# Favorite films metadata (manually maintained since Letterboxd export only has URLs)
FAVORITE_FILMS = {
    'https://boxd.it/icFU': {'name': 'The Lighthouse', 'year': '2019'},
    'https://boxd.it/2a88': {'name': 'Spider-Man 2', 'year': '2004'},
    'https://boxd.it/2awY': {'name': 'Alien', 'year': '1979'},
    'https://boxd.it/2aHW': {'name': 'The Silence of the Lambs', 'year': '1991'},
}


def load_poster_cache() -> dict:
    """Load cached poster URLs."""
    if POSTER_CACHE_FILE.exists():
        try:
            return json.loads(POSTER_CACHE_FILE.read_text(encoding='utf-8'))
        except (json.JSONDecodeError, IOError):
            pass
    return {}


def save_poster_cache(cache: dict):
    """Save poster cache to file."""
    POSTER_CACHE_FILE.write_text(json.dumps(cache, indent=2), encoding='utf-8')


def fetch_tmdb_data(title: str, year: str, cache: dict) -> dict:
    """Fetch poster URL and director from TMDb API.

    Returns dict with 'poster' and 'director' keys.
    """
    cache_key = f"{title}|{year}"

    # Check cache first (now stores dict with poster and director)
    if cache_key in cache:
        cached = cache[cache_key]
        # Handle old cache format (just poster string)
        if isinstance(cached, str):
            return {'poster': cached, 'director': ''}
        return cached

    result = {'poster': '', 'director': ''}

    try:
        # Search for the movie
        query = urllib.parse.quote(title)
        url = f"https://api.themoviedb.org/3/search/movie?api_key={TMDB_API_KEY}&query={query}&year={year}"

        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))

        if data.get('results') and len(data['results']) > 0:
            movie = data['results'][0]
            movie_id = movie.get('id')

            # Get poster
            poster_path = movie.get('poster_path')
            if poster_path:
                result['poster'] = f"{TMDB_IMAGE_BASE}{poster_path}"

            # Fetch credits to get director
            if movie_id:
                credits_url = f"https://api.themoviedb.org/3/movie/{movie_id}/credits?api_key={TMDB_API_KEY}"
                req = urllib.request.Request(credits_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=10) as response:
                    credits_data = json.loads(response.read().decode('utf-8'))

                # Find director in crew
                crew = credits_data.get('crew', [])
                directors = [c['name'] for c in crew if c.get('job') == 'Director']
                if directors:
                    result['director'] = directors[0]  # Use first director

        cache[cache_key] = result
        return result

    except Exception as e:
        print(f"    Warning: Failed to fetch TMDb data for {title}: {e}")
        cache[cache_key] = result
        return result


def load_favorites(csv_path: Path) -> list:
    """Load favorite films from profile.csv."""
    favorites = []
    if not csv_path.exists():
        return favorites

    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            fav_urls = row.get('Favorite Films', '')
            if fav_urls:
                urls = [url.strip() for url in fav_urls.split(',')]
                for url in urls:
                    if url in FAVORITE_FILMS:
                        film = FAVORITE_FILMS[url].copy()
                        film['url'] = url
                        favorites.append(film)

    return favorites


def generate_favorites_html(favorites: list, cache: dict) -> str:
    """Generate HTML for favorites section with posters."""
    if not favorites:
        return '<p class="empty-message">No favorites set.</p>'

    cards = []
    for film in favorites:
        tmdb_data = fetch_tmdb_data(film['name'], film['year'], cache)
        poster_url = tmdb_data['poster']

        if poster_url:
            poster_html = f'<img src="{poster_url}" alt="{film["name"]} poster" class="favorite-poster" loading="lazy">'
        else:
            poster_html = '<div class="favorite-poster-placeholder"></div>'

        card = f'''<div class="favorite-card">
                    {poster_html}
                    <div class="favorite-info">
                        <h3>{film['name']}</h3>
                        <span class="year">{film['year']}</span>
                    </div>
                </div>'''
        cards.append(card)

    return '\n                '.join(cards)


def slugify(name: str) -> str:
    """Convert movie name to URL-friendly slug."""
    slug = name.lower()
    slug = re.sub(r'[^a-z0-9\s-]', '', slug)
    slug = re.sub(r'[\s_]+', '-', slug)
    slug = re.sub(r'-+', '-', slug)
    return slug.strip('-')


def rating_to_stars(rating: float) -> str:
    if not rating:
        return ""
    full = int(rating)
    has_half = rating % 1 >= 0.5
    html = ""
    for i in range(5):
        if i < full:
            fill = "star-full"
        elif i == full and has_half:
            fill = "star-half"
        else:
            fill = "star-empty"
        html += f'<span class="star star-{i+1} {fill}">★</span>'
    return html


def load_movies(csv_path: Path) -> list:
    """Load movies from Letterboxd reviews.csv export."""
    movies = []

    if not csv_path.exists():
        print(f"  Warning: {csv_path} not found")
        return movies

    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get('Name', '').strip()
            if not name:
                continue

            # Parse rating
            rating_str = row.get('Rating', '')
            try:
                rating = float(rating_str) if rating_str else None
            except ValueError:
                rating = None

            # Parse watched date
            watched_str = row.get('Watched Date', '')
            try:
                watched_date = datetime.strptime(watched_str, '%Y-%m-%d') if watched_str else None
            except ValueError:
                watched_date = None

            # Get review text
            review = row.get('Review', '').strip()

            # Check if rewatch
            rewatch = row.get('Rewatch', '').strip().lower() == 'yes'

            movies.append({
                'id': slugify(name),
                'name': name,
                'year': row.get('Year', '').strip(),
                'rating': rating,
                'stars': rating_to_stars(rating),
                'watched_date': watched_date,
                'watched_str': watched_str,
                'rewatch': rewatch,
                'review': review,
                'letterboxd_uri': row.get('Letterboxd URI', '').strip(),
                'tags': row.get('Tags', '').strip(),
            })

    # Sort by watched date (newest first)
    movies.sort(key=lambda m: m['watched_date'] or datetime.min, reverse=True)

    return movies


def format_review(review_text: str) -> str:
    """Convert review text to HTML paragraphs."""
    if not review_text:
        return ""

    # Split by double newlines or single newlines
    paragraphs = re.split(r'\n\s*\n|\n', review_text.strip())
    html_parts = []

    for para in paragraphs:
        para = para.strip()
        if para:
            # Escape HTML but preserve intentional formatting
            para = para.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            html_parts.append(f'<p>{para}</p>')

    return '\n                        '.join(html_parts)


def calculate_stats(movies: list) -> dict:
    """Calculate aggregate statistics."""
    rated_movies = [m for m in movies if m['rating'] is not None]

    stats = {
        'total_watched': len(movies),
        'total_reviewed': len([m for m in movies if m['review']]),
        'average_rating': sum(m['rating'] for m in rated_movies) / len(rated_movies) if rated_movies else 0,
        'five_star': len([m for m in movies if m['rating'] == 5]),
        'rewatches': len([m for m in movies if m['rewatch']]),
    }

    return stats


def generate_stats_html(stats: dict) -> str:
    """Generate HTML for stats section."""
    return f'''<div class="stat-grid">
                <div class="stat-item">
                    <span class="stat-value">{stats['total_watched']}</span>
                    <span class="stat-label">Movies Watched</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">{stats['average_rating']:.1f}</span>
                    <span class="stat-label">Average Rating</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">{stats['five_star']}</span>
                    <span class="stat-label">5-Star Films</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">{stats['total_reviewed']}</span>
                    <span class="stat-label">With Reviews</span>
                </div>
            </div>'''


def generate_movie_card(movie: dict, tmdb_data: dict) -> str:
    """Generate HTML for a single collapsible movie card."""
    poster_url = tmdb_data.get('poster', '')
    director = tmdb_data.get('director', '')

    # Format watched date
    date_display = ""
    if movie['watched_date']:
        date_display = movie['watched_date'].strftime('%b %d, %Y')

    # Rating display
    rating_html = ""
    if movie['stars']:
        rating_html = f'<span class="rating">{movie["stars"]}</span>'

    # Director display
    director_html = f'<span class="director">Dir: {director}</span>' if director else ''

    # Rewatch badge
    rewatch_html = '<span class="rewatch-badge">Rewatch</span>' if movie['rewatch'] else ''

    # Year display
    year_html = f'<span class="year">({movie["year"]})</span>' if movie['year'] else ''

    # Poster HTML
    if poster_url:
        poster_html = f'<img src="{poster_url}" alt="{movie["name"]} poster" class="movie-poster" loading="lazy">'
    else:
        poster_html = '<div class="movie-poster-placeholder"></div>'

    # Review section
    review_html = ""
    if movie['review']:
        formatted_review = format_review(movie['review'])
        review_html = f'''<div class="movie-card__review">
                        {formatted_review}
                    </div>'''

    # Letterboxd link
    letterboxd_link = ""
    if movie['letterboxd_uri']:
        letterboxd_link = f'<a href="{movie["letterboxd_uri"]}" target="_blank" class="letterboxd-link" title="View on Letterboxd">View on Letterboxd</a>'

    # Check if card has expandable content
    has_content = bool(movie['review'] or poster_url)
    expandable_class = "expandable" if has_content else ""
    expand_icon = '<span class="expand-icon">+</span>' if has_content else ''

    # Check if 5-star movie
    five_star_class = "five-star" if movie['rating'] == 5 else ""

    # Escape director for data attribute
    director_escaped = director.replace('"', '&quot;')

    return f'''
            <article class="movie-card {expandable_class} {five_star_class}" id="{movie['id']}"
                     data-rating="{movie['rating'] or 0}"
                     data-date="{movie['watched_str']}"
                     data-name="{movie['name']}"
                     data-director="{director_escaped}">
                <div class="movie-card__header">
                    <div class="movie-card__info">
                        <h3>{movie['name']} {year_html}</h3>
                        <div class="movie-meta">
                            {rating_html}
                            {director_html}
                            <span class="date">{date_display}</span>
                            {rewatch_html}
                        </div>
                    </div>
                    {expand_icon}
                </div>
                <div class="movie-card__details">
                    <div class="movie-card__content">
                        <div class="movie-card__poster">
                            {poster_html}
                        </div>
                        <div class="movie-card__text">
                            {review_html}
                            <div class="movie-card__footer">
                                {letterboxd_link}
                            </div>
                        </div>
                    </div>
                </div>
            </article>'''


def build_page(movies: list, template: str, stats: dict, favorites: list, cache: dict) -> str:
    """Build the complete HTML page."""
    # Generate HTML sections
    favorites_html = generate_favorites_html(favorites, cache)
    stats_html = generate_stats_html(stats)

    # Collect directors and build movie cards
    directors = set()
    movie_cards = []

    if movies:
        for m in movies:
            tmdb_data = fetch_tmdb_data(m['name'], m['year'], cache)
            if tmdb_data.get('director'):
                directors.add(tmdb_data['director'])
            movie_cards.append(generate_movie_card(m, tmdb_data))
        movies_html = '\n'.join(movie_cards)
    else:
        movies_html = '<p class="empty-message">No movies tracked yet.</p>'

    # Generate director filter options
    director_options = ['<option value="all">All Directors</option>']
    for director in sorted(directors):
        escaped = director.replace('"', '&quot;')
        director_options.append(f'<option value="{escaped}">{director}</option>')
    directors_html = '\n                    '.join(director_options)

    # Replace placeholders in template
    output = template
    output = output.replace('{{FAVORITES}}', favorites_html)
    output = output.replace('{{STATS}}', stats_html)
    output = output.replace('{{MOVIES}}', movies_html)
    output = output.replace('{{DIRECTOR_OPTIONS}}', directors_html)
    output = output.replace('{{BUILD_DATE}}', datetime.now().strftime('%Y-%m-%d'))

    return output


def main():
    """Main entry point."""
    print("=" * 50)
    print("Movie Reviews Page Builder")
    print("=" * 50)

    # Load poster cache
    print("\nLoading poster cache...")
    cache = load_poster_cache()
    print(f"  Cached posters: {len(cache)}")

    print(f"\nLoading favorites from {PROFILE_FILE.name}...")
    favorites = load_favorites(PROFILE_FILE)
    print(f"  Loaded {len(favorites)} favorite films")

    print(f"\nLoading movies from {REVIEWS_FILE.name}...")
    movies = load_movies(REVIEWS_FILE)
    print(f"  Loaded {len(movies)} movies")

    print("\nLoading template...")
    if not TEMPLATE_FILE.exists():
        print(f"  ERROR: Template not found at {TEMPLATE_FILE}")
        return 1
    template = TEMPLATE_FILE.read_text(encoding='utf-8')

    print("\nCalculating stats...")
    stats = calculate_stats(movies)
    print(f"  Average rating: {stats['average_rating']:.2f}")
    print(f"  5-star films: {stats['five_star']}")

    print("\nFetching posters and building page...")
    output_html = build_page(movies, template, stats, favorites, cache)

    # Save poster cache
    print("\nSaving poster cache...")
    save_poster_cache(cache)
    print(f"  Cached posters: {len(cache)}")

    print(f"\nWriting to {OUTPUT_FILE}...")
    OUTPUT_FILE.write_text(output_html, encoding='utf-8')

    print("\n" + "=" * 50)
    print("Done! Open movies.html in your browser to preview.")
    print("=" * 50)

    return 0


if __name__ == '__main__':
    exit(main())
