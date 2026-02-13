#!/usr/bin/env python3
"""
Static site generator for Emmet's Game Reviews page.

Usage: python build.py
Reads: src/games.csv (or games.csv.csv), src/reviews.md, src/template.html
Outputs: games.html

Reviews are fetched from a Google Doc on each build and saved to src/reviews.md.
"""

import csv
import json
import re
import urllib.request
import urllib.parse
from pathlib import Path
from datetime import datetime

# Paths
SCRIPT_DIR = Path(__file__).parent
SRC_DIR = SCRIPT_DIR / "src"
REVIEWS_FILE = SRC_DIR / "reviews.md"
TEMPLATE_FILE = SRC_DIR / "template.html"
OUTPUT_FILE = SCRIPT_DIR / "games.html"
IMAGE_CACHE_FILE = SRC_DIR / "image_cache.json"

# Google Doc containing written reviews (exported as plain text)
REVIEWS_DOC_ID = "11qfBD3qx2nzRz-QpZl4IywJSB3oqsIvcYhNt_21dBsA"

# RAWG API key — loaded from config.json (gitignored)
CONFIG_FILE = SCRIPT_DIR / "config.json"
if CONFIG_FILE.exists():
    _config = json.loads(CONFIG_FILE.read_text(encoding='utf-8'))
    RAWG_API_KEY = _config.get('rawg_api_key', '')
else:
    RAWG_API_KEY = ''
    print("Warning: config.json not found — RAWG image fetch will be skipped")
    print("  Create Game_review/config.json with: {\"rawg_api_key\": \"YOUR_KEY\"}")


def fetch_reviews_from_gdoc() -> bool:
    """Fetch reviews from Google Doc (HTML export) and convert to reviews.md.

    Google Docs uses 'title'-class paragraphs for game names rather than
    proper heading tags, so we parse the HTML and convert to markdown with
    # headers that load_reviews() expects.

    Returns True if successful, False otherwise (falls back to local file).
    """
    url = f"https://docs.google.com/document/d/{REVIEWS_DOC_ID}/export?format=html"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'EmmetGameReviews/1.0'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode('utf-8')

        return _convert_gdoc_html_to_md(html)
    except Exception as e:
        print(f"  Warning: Could not fetch reviews from Google Doc: {e}")
        return False


def _convert_gdoc_html_to_md(html: str) -> bool:
    """Convert Google Doc HTML export to markdown reviews file."""
    import html as html_module

    # Extract the body content
    body_match = re.search(r'<body[^>]*>(.*?)</body>', html, re.DOTALL)
    if not body_match:
        print("  Warning: Could not find body in Google Doc HTML")
        return False

    body = body_match.group(1)

    # Find all paragraphs with their classes and content
    paragraphs = re.findall(r'<p[^>]*class="([^"]*)"[^>]*>(.*?)</p>', body, re.DOTALL)

    md_lines = []

    for classes, content in paragraphs:
        # Strip HTML tags but preserve italic/bold markers
        text = content
        # Convert italic spans
        text = re.sub(r'<span[^>]*font-style:italic[^>]*>(.*?)</span>', r'*\1*', text)
        text = re.sub(r'<span[^>]*class="[^"]*c8[^"]*"[^>]*>(.*?)</span>', r'*\1*', text)
        # Strip remaining HTML tags, preserving <br> as newlines
        text = text.replace('<br>', '\n')
        text = re.sub(r'<[^>]+>', '', text)
        # Decode HTML entities
        text = html_module.unescape(text)
        # Normalize whitespace within each line but preserve paragraph breaks
        text = re.sub(r'[ \t]+', ' ', text).strip()
        # Convert non-breaking spaces to regular spaces
        text = text.replace('\u00a0', ' ')

        if not text:
            continue

        if 'title' in classes:
            # This is a game title heading
            md_lines.append(f'\n# {text}\n')
        else:
            md_lines.append(text)

    if not md_lines:
        print("  Warning: No content extracted from Google Doc HTML")
        return False

    md_content = '\n'.join(md_lines)
    REVIEWS_FILE.write_text(md_content, encoding='utf-8')
    return True


def find_csv_file() -> Path:
    """Find the CSV file, handling Google's .csv.csv export naming."""
    candidates = [
        SRC_DIR / "games.csv",
        SRC_DIR / "games.csv.csv",  # Google Sheets export sometimes adds extra .csv
    ]
    for path in candidates:
        if path.exists():
            return path
    return SRC_DIR / "games.csv"  # Default


def load_image_cache() -> dict:
    """Load cached game image URLs."""
    if IMAGE_CACHE_FILE.exists():
        return json.loads(IMAGE_CACHE_FILE.read_text(encoding='utf-8'))
    return {}


def save_image_cache(cache: dict):
    """Save game image cache to disk."""
    IMAGE_CACHE_FILE.write_text(
        json.dumps(cache, indent=2, ensure_ascii=False),
        encoding='utf-8'
    )


def fetch_game_image(name: str, cache: dict, rawg_id: str = '') -> str:
    """Fetch game background image from RAWG API, with caching."""
    if name in cache:
        return cache[name]

    if not RAWG_API_KEY:
        return ""  # Don't cache — will retry once key is added

    try:
        if rawg_id:
            # Direct lookup by RAWG ID — guaranteed correct result
            url = f"https://api.rawg.io/api/games/{rawg_id}?key={RAWG_API_KEY}"
            req = urllib.request.Request(url, headers={'User-Agent': 'EmmetGameReviews/1.0'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                image_url = data.get('background_image', '')
                cache[name] = image_url
                return image_url
        else:
            # Search by name — works for well-known titles
            query = urllib.parse.urlencode({
                'key': RAWG_API_KEY,
                'search': name,
                'page_size': 1
            })
            url = f"https://api.rawg.io/api/games?{query}"
            req = urllib.request.Request(url, headers={'User-Agent': 'EmmetGameReviews/1.0'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                results = data.get('results', [])
                if results:
                    image_url = results[0].get('background_image', '')
                    cache[name] = image_url
                    return image_url
    except Exception as e:
        print(f"    Warning: Could not fetch image for '{name}': {e}")

    cache[name] = ""
    return ""


def slugify(name: str) -> str:
    """Convert game name to URL-friendly slug."""
    slug = name.lower()
    slug = re.sub(r'[^a-z0-9\s-]', '', slug)
    slug = re.sub(r'[\s_]+', '-', slug)
    slug = re.sub(r'-+', '-', slug)
    return slug.strip('-')


def load_games(csv_path: Path) -> tuple:
    """
    Load games from CSV file.
    Returns (games_list, summary_stats_dict)
    """
    games = []
    summary_stats = {}

    if not csv_path.exists():
        print(f"  Warning: {csv_path} not found")
        return games, summary_stats

    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Get the title - skip empty rows or summary rows
            name = row.get('Title', row.get('name', row.get('Name', ''))).strip()
            if not name:
                # Check if this is a summary row (has percentages)
                # The row with percentages has empty Title but data in other columns
                for key, val in row.items():
                    if val and '%' in str(val):
                        # Extract percentage values
                        match = re.search(r'([\d.]+)%', val)
                        if match:
                            if 'beat' in key.lower() or 'Actual time to beat' in key:
                                summary_stats['beat_percentage'] = float(match.group(1))
                            elif 'complete' in key.lower() or 'Actual time to complete' in key:
                                summary_stats['complete_percentage'] = float(match.group(1))
                continue

            time_played = parse_hours(row.get('Time Played', ''))
            actual_beat = parse_hours(row.get('Actual time to beat', ''))

            # Use Status column directly; fall back to must-play if empty
            raw_status = row.get('Status', '').strip()
            if raw_status:
                # Normalize: "In Progress" -> "in-progress", "Completed" -> "completed"
                status = raw_status.lower().replace(' ', '-')
            else:
                status = 'must-play'

            # Get genre
            genre = row.get('Genre', '').strip()

            # Get estimated time (for backlog) or actual time (for played)
            est_time = parse_hours(row.get('Estimated time to beat', ''))

            # Get platform
            platform = row.get('Console', '').strip()

            # Get play order
            play_order_str = row.get('Play order', '').strip()
            play_order = int(play_order_str) if play_order_str.isdigit() else 0

            # Get date last played
            date_last_played = row.get('Date Last Played', '').strip()

            # Optional RAWG ID override for ambiguous game names
            rawg_id = (row.get('RAWG ID') or '').strip()

            games.append({
                'id': slugify(name),
                'name': name,
                'genre': genre,
                'hours': time_played if time_played > 0 else est_time,
                'hours_played': time_played,
                'est_hours': est_time,
                'actual_beat': actual_beat,
                'status': status,
                'platform': platform,
                'play_order': play_order,
                'date_last_played': date_last_played,
                'rawg_id': rawg_id,
            })

    return games, summary_stats


def parse_hours(hours_str: str) -> float:
    """Parse hours string to float."""
    if not hours_str:
        return 0.0
    try:
        # Handle "10h", "10 hours", "10.5", etc.
        cleaned = re.sub(r'[^\d.]', '', str(hours_str))
        return float(cleaned) if cleaned else 0.0
    except ValueError:
        return 0.0


def load_reviews(md_path: Path) -> dict:
    """Parse reviews markdown into dict keyed by game slug."""
    reviews = {}
    if not md_path.exists():
        print(f"  Warning: {md_path} not found")
        return reviews

    content = md_path.read_text(encoding='utf-8')

    # Ensure content starts with newline for consistent parsing
    if not content.startswith('\n'):
        content = '\n' + content

    # Split by H1 headers - match game titles with apostrophes, spaces, etc.
    # Pattern: newline, #, space, then capture everything until next newline
    sections = re.split(r'\n# ([^\n]+)\n', content)

    # sections[0] is content before first header (usually empty)
    # sections[1], sections[2], ... = title, content pairs
    for i in range(1, len(sections), 2):
        game_title = sections[i].strip()
        game_slug = slugify(game_title)
        review_content = sections[i + 1] if i + 1 < len(sections) else ""
        reviews[game_slug] = markdown_to_html(review_content.strip())

    return reviews


def markdown_to_html(md_text: str) -> str:
    """Convert simple markdown to HTML paragraphs."""
    # Remove the title line at the start (game name repeated)
    lines = md_text.split('\n')
    # Skip first non-empty line if it looks like a title (no leading whitespace, short)
    if lines and lines[0].strip() and len(lines[0].strip()) < 50 and not lines[0].startswith(' '):
        # Check if it matches the game title pattern
        first_line = lines[0].strip()
        if not first_line.startswith('*') and not first_line.startswith('-'):
            lines = lines[1:]
    md_text = '\n'.join(lines)

    # Remove backslash escapes from Google Docs export (e.g., \!, \-, \*)
    md_text = re.sub(r'\\([!?\-*])', r'\1', md_text)

    # Remove horizontal rules
    md_text = re.sub(r'\n---\n?', '\n\n', md_text)

    # Convert markdown italics *text* to HTML
    md_text = re.sub(r'\*([^*]+)\*', r'<em>\1</em>', md_text)

    # Convert markdown bold **text** to HTML
    md_text = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', md_text)

    # Split into paragraphs (double newline or tab-indented lines)
    # Handle tab-indented paragraphs
    md_text = re.sub(r'\n\t', '\n\n', md_text)

    paragraphs = re.split(r'\n\s*\n', md_text.strip())
    html_parts = []

    for para in paragraphs:
        para = para.strip()
        if para:
            # Clean up the paragraph - normalize whitespace
            para = ' '.join(para.split())
            html_parts.append(f'<p>{para}</p>')

    return '\n                '.join(html_parts)


def calculate_stats(games: list, summary_stats: dict) -> dict:
    """Calculate aggregate statistics."""
    played_games = [g for g in games if g['status'] != 'must-play']
    completed_games = [g for g in games if g['status'] == 'completed']

    stats = {
        'total_tracked': len(played_games),
        'total_hours': sum(g['hours_played'] for g in played_games),
        'completed': len(completed_games),
        'must_play': len([g for g in games if g['status'] == 'must-play']),
        'in_progress': len([g for g in games if g['status'] == 'in-progress']),
    }

    # Add summary percentages if available
    if 'beat_percentage' in summary_stats:
        stats['beat_percentage'] = summary_stats['beat_percentage']
    if 'complete_percentage' in summary_stats:
        stats['complete_percentage'] = summary_stats['complete_percentage']

    return stats


def generate_stats_html(stats: dict) -> str:
    """Generate HTML for stats section."""
    # Build percentage stats if available
    percentage_html = ''
    if 'beat_percentage' in stats:
        percentage_html += f'''
                <div class="stat-item">
                    <span class="stat-value">{stats['beat_percentage']:.0f}%</span>
                    <span class="stat-label">Beat vs Estimated</span>
                </div>'''
    if 'complete_percentage' in stats:
        percentage_html += f'''
                <div class="stat-item">
                    <span class="stat-value">{stats['complete_percentage']:.0f}%</span>
                    <span class="stat-label">Complete vs Estimated</span>
                </div>'''

    return f'''<div class="stat-grid">
                <div class="stat-item">
                    <span class="stat-value">{stats['total_tracked']}</span>
                    <span class="stat-label">Games Played</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">{stats['total_hours']:.0f}</span>
                    <span class="stat-label">Hours Played</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">{stats['completed']}</span>
                    <span class="stat-label">Completed</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">{stats['must_play']}</span>
                    <span class="stat-label">In Backlog</span>
                </div>{percentage_html}
            </div>'''


def generate_backlog_card(game: dict) -> str:
    """Generate compact card for must-play games."""
    genre_html = f'<span class="genre">{game["genre"]}</span>' if game['genre'] else ''
    hours_html = f'<span class="est-hours">~{game["est_hours"]:.0f}h</span>' if game['est_hours'] else ''
    platform_html = f'<span class="platform">{game["platform"]}</span>' if game['platform'] else ''

    meta_parts = [p for p in [genre_html, hours_html, platform_html] if p]
    meta_html = ' '.join(meta_parts)

    return f'''<div class="backlog-card">
                    <h3>{game['name']}</h3>
                    {f'<div class="backlog-meta">{meta_html}</div>' if meta_html else ''}
                </div>'''


def generate_game_card(game: dict, review_html: str = None, image_url: str = '') -> str:
    """Generate HTML for a single game card."""
    hours_display = f"{game['hours_played']:.1f}h" if game['hours_played'] else ''

    meta_items = []
    if game['genre']:
        meta_items.append(f'<span class="genre">{game["genre"]}</span>')
    if hours_display:
        meta_items.append(f'<span class="hours">{hours_display}</span>')
    if game['platform']:
        meta_items.append(f'<span class="platform">{game["platform"]}</span>')
    meta_items.append(f'<span class="status-badge status-{game["status"]}">{game["status"].replace("-", " ").title()}</span>')

    meta_html = '\n                        '.join(meta_items)

    # Image in header
    cover_html = ''
    if image_url:
        cover_html = f'<img class="game-card__cover" src="{image_url}" alt="{game["name"]}" loading="lazy">'

    # Expandable class and icon only for cards with reviews
    expandable_class = ' expandable' if review_html else ''
    expand_icon = '<span class="expand-icon">+</span>' if review_html else ''

    # Review in collapsible details section
    review_section = ''
    if review_html:
        review_section = f'''
            <div class="game-card__details">
                <div class="game-card__content">
                    {review_html}
                </div>
            </div>'''

    return f'''
        <article class="game-card{expandable_class}" id="{game['id']}"
                 data-hours="{game['hours_played']}"
                 data-status="{game['status']}"
                 data-name="{game['name']}"
                 data-play-order="{game['play_order']}"
                 data-date-last-played="{game['date_last_played']}">
            <div class="game-card__header">
                {cover_html}
                <div class="game-card__info">
                    <h3>{game['name']}</h3>
                    <div class="game-meta">
                        {meta_html}
                    </div>
                </div>
                {expand_icon}
            </div>{review_section}
        </article>'''


def match_reviews_to_games(games: list, reviews: dict) -> dict:
    """Match review slugs to game slugs, handling title differences.

    The Google Doc titles may differ slightly from the CSV names
    (e.g. "Rogue Prince of Persia" vs "The Rogue Prince"), so we try
    exact match first, then substring containment.

    Returns a dict mapping game_id -> review_html.
    """
    matched = {}
    unmatched_reviews = dict(reviews)

    # Pass 1: exact slug match
    for game in games:
        if game['id'] in unmatched_reviews:
            matched[game['id']] = unmatched_reviews.pop(game['id'])

    # Pass 2: substring containment (longer slug contains shorter)
    if unmatched_reviews:
        for game in games:
            if game['id'] in matched:
                continue
            for review_slug, review_html in list(unmatched_reviews.items()):
                if game['id'] in review_slug or review_slug in game['id']:
                    matched[game['id']] = review_html
                    del unmatched_reviews[review_slug]
                    break

    # Pass 3: significant word overlap (e.g. "The Rogue Prince" vs "Rogue Prince of Persia")
    if unmatched_reviews:
        stop_words = {'the', 'a', 'an', 'of', 'and', 'in', 'on', 'at', 'to', 'for'}
        for game in games:
            if game['id'] in matched:
                continue
            game_words = set(game['id'].split('-')) - stop_words
            if len(game_words) < 2:
                continue
            for review_slug, review_html in list(unmatched_reviews.items()):
                review_words = set(review_slug.split('-')) - stop_words
                overlap = game_words & review_words
                # Match if most significant words overlap
                if len(overlap) >= min(len(game_words), len(review_words)):
                    matched[game['id']] = review_html
                    del unmatched_reviews[review_slug]
                    break

    if unmatched_reviews:
        print(f"  Warning: {len(unmatched_reviews)} review(s) could not be matched to games:")
        for slug in unmatched_reviews:
            print(f"    - {slug}")

    return matched


def build_page(games: list, reviews: dict, template: str, stats: dict, image_cache: dict) -> str:
    """Build the complete HTML page."""
    # Match reviews to games (handles title differences between Doc and CSV)
    matched_reviews = match_reviews_to_games(games, reviews)

    # Separate games by status
    must_play = [g for g in games if g['status'] == 'must-play']
    tracked = [g for g in games if g['status'] != 'must-play']

    # Sort tracked games by date last played (most recent first)
    tracked.sort(key=lambda g: g['date_last_played'] or '', reverse=True)

    # Generate HTML sections
    stats_html = generate_stats_html(stats)

    if must_play:
        must_play_html = '\n                '.join(generate_backlog_card(g) for g in must_play)
    else:
        must_play_html = '<p class="empty-message">No games in backlog. Time to find something new!</p>'

    if tracked:
        tracked_html = '\n'.join(
            generate_game_card(g, matched_reviews.get(g['id']), image_cache.get(g['name'], ''))
            for g in tracked
        )
    else:
        tracked_html = '<p class="empty-message">No games tracked yet. Export your data to get started!</p>'

    # Replace placeholders in template
    output = template
    output = output.replace('{{STATS}}', stats_html)
    output = output.replace('{{MUST_PLAY}}', must_play_html)
    output = output.replace('{{TRACKED_GAMES}}', tracked_html)
    output = output.replace('{{BUILD_DATE}}', datetime.now().strftime('%Y-%m-%d'))

    return output


def main():
    """Main entry point."""
    print("=" * 50)
    print("Game Reviews Page Builder")
    print("=" * 50)

    csv_file = find_csv_file()
    print(f"\nLoading games data from {csv_file.name}...")
    games, summary_stats = load_games(csv_file)
    print(f"  Loaded {len(games)} games")
    if summary_stats:
        print(f"  Found summary stats: {summary_stats}")

    print("\nFetching reviews from Google Doc...")
    if fetch_reviews_from_gdoc():
        print("  Successfully fetched reviews from Google Doc")
    else:
        print("  Using local reviews.md as fallback")

    print("\nLoading reviews...")
    reviews = load_reviews(REVIEWS_FILE)
    print(f"  Loaded {len(reviews)} reviews")

    print("\nLoading template...")
    if not TEMPLATE_FILE.exists():
        print(f"  ERROR: Template not found at {TEMPLATE_FILE}")
        return 1
    template = TEMPLATE_FILE.read_text(encoding='utf-8')

    # Fetch game images
    print("\nLoading game images...")
    image_cache = load_image_cache()
    tracked_games = [g for g in games if g['status'] != 'must-play']
    if not RAWG_API_KEY:
        print("  No RAWG API key set — skipping image fetch")
        print("  Get a free key at https://rawg.io/apidocs")
    else:
        fetched = 0
        for game in tracked_games:
            if game['name'] not in image_cache:
                fetch_game_image(game['name'], image_cache, game.get('rawg_id', ''))
                fetched += 1
        if fetched:
            print(f"  Fetched {fetched} new images from RAWG")
        save_image_cache(image_cache)
    cached = sum(1 for g in tracked_games if image_cache.get(g['name']))
    print(f"  {cached}/{len(tracked_games)} games have images")

    print("\nCalculating stats...")
    stats = calculate_stats(games, summary_stats)

    print("\nBuilding page...")
    output_html = build_page(games, reviews, template, stats, image_cache)

    print(f"\nWriting to {OUTPUT_FILE}...")
    OUTPUT_FILE.write_text(output_html, encoding='utf-8')

    print("\n" + "=" * 50)
    print("Done! Open games.html in your browser to preview.")
    print("=" * 50)

    return 0


if __name__ == '__main__':
    exit(main())
