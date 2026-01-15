#!/usr/bin/env python3
"""
Static site generator for Emmet's Game Reviews page.

Usage: python build.py
Reads: src/games.csv (or games.csv.csv), src/reviews.md, src/template.html
Outputs: games.html
"""

import csv
import re
from pathlib import Path
from datetime import datetime

# Paths
SCRIPT_DIR = Path(__file__).parent
SRC_DIR = SCRIPT_DIR / "src"
REVIEWS_FILE = SRC_DIR / "reviews.md"
TEMPLATE_FILE = SRC_DIR / "template.html"
OUTPUT_FILE = SCRIPT_DIR / "games.html"


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

            # Determine status based on Time Played
            time_played = parse_hours(row.get('Time Played', ''))
            actual_beat = parse_hours(row.get('Actual time to beat', ''))

            if time_played > 0:
                # They've played it
                if actual_beat > 0:
                    status = 'completed'
                else:
                    status = 'in-progress'
            else:
                status = 'must-play'

            # Get genre
            genre = row.get('Genre', '').strip()

            # Get estimated time (for backlog) or actual time (for played)
            est_time = parse_hours(row.get('Estimated time to beat', ''))

            # Get platform
            platform = row.get('Console', '').strip()

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


def generate_game_card(game: dict, review_html: str = None) -> str:
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

    review_section = ''
    if review_html:
        review_section = f'''
            <div class="game-card__review">
                {review_html}
            </div>'''

    return f'''
        <article class="game-card" id="{game['id']}"
                 data-hours="{game['hours_played']}"
                 data-status="{game['status']}"
                 data-name="{game['name']}">
            <div class="game-card__header">
                <div class="game-card__info">
                    <h3>{game['name']}</h3>
                    <div class="game-meta">
                        {meta_html}
                    </div>
                </div>
            </div>{review_section}
        </article>'''


def build_page(games: list, reviews: dict, template: str, stats: dict) -> str:
    """Build the complete HTML page."""
    # Separate games by status
    must_play = [g for g in games if g['status'] == 'must-play']
    tracked = [g for g in games if g['status'] != 'must-play']

    # Sort tracked games by hours played (most first)
    tracked.sort(key=lambda g: g['hours_played'], reverse=True)

    # Generate HTML sections
    stats_html = generate_stats_html(stats)

    if must_play:
        must_play_html = '\n                '.join(generate_backlog_card(g) for g in must_play)
    else:
        must_play_html = '<p class="empty-message">No games in backlog. Time to find something new!</p>'

    if tracked:
        tracked_html = '\n'.join(
            generate_game_card(g, reviews.get(g['id']))
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

    print("\nLoading reviews...")
    reviews = load_reviews(REVIEWS_FILE)
    print(f"  Loaded {len(reviews)} reviews")

    print("\nLoading template...")
    if not TEMPLATE_FILE.exists():
        print(f"  ERROR: Template not found at {TEMPLATE_FILE}")
        return 1
    template = TEMPLATE_FILE.read_text(encoding='utf-8')

    print("\nCalculating stats...")
    stats = calculate_stats(games, summary_stats)

    print("\nBuilding page...")
    output_html = build_page(games, reviews, template, stats)

    print(f"\nWriting to {OUTPUT_FILE}...")
    OUTPUT_FILE.write_text(output_html, encoding='utf-8')

    print("\n" + "=" * 50)
    print("Done! Open games.html in your browser to preview.")
    print("=" * 50)

    return 0


if __name__ == '__main__':
    exit(main())
