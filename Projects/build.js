/**
 * Projects page builder
 * Reads process.md files from project folders and generates projects.html
 *
 * Usage: node build.js
 */

const fs = require('fs');
const path = require('path');

const PROJECTS_DIR = __dirname;
const OUTPUT_FILE = path.join(PROJECTS_DIR, 'projects.html');

// Find all process.md files
function findProjectFiles() {
    const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
    const projects = [];

    for (const entry of entries) {
        if (entry.isDirectory()) {
            const mdPath = path.join(PROJECTS_DIR, entry.name, 'process.md');
            if (fs.existsSync(mdPath)) {
                projects.push({
                    folder: entry.name,
                    mdPath: mdPath
                });
            }
        }
    }
    return projects;
}

// Parse YAML front matter from markdown
function parseFrontMatter(content) {
    // Handle both Unix (\n) and Windows (\r\n) line endings
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) return { meta: {}, body: content };

    const yamlStr = match[1];
    const body = match[2];
    const meta = {};

    // Simple YAML parser for our needs (handle \r\n line endings too)
    for (const line of yamlStr.split(/\r?\n/)) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;

        const key = line.slice(0, colonIdx).trim();
        let value = line.slice(colonIdx + 1).trim();

        // Handle arrays like ["tag1", "tag2"]
        if (value.startsWith('[') && value.endsWith(']')) {
            value = value.slice(1, -1)
                .split(',')
                .map(s => s.trim().replace(/^["']|["']$/g, ''));
        } else {
            // Remove quotes
            value = value.replace(/^["']|["']$/g, '');
        }

        meta[key] = value;
    }

    return { meta, body };
}

// Convert markdown to HTML (simple converter)
function markdownToHtml(md, projectFolder) {
    let html = md;

    // Images: ![alt](path) -> <img>
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
        // Make path relative to project folder
        const imgPath = `${projectFolder}/${src}`;
        return `<img src="${imgPath}" alt="${alt}" class="project-image" loading="lazy">`;
    });

    // Links: [text](url) -> <a>
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // Headers
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');

    // Bold and italic
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Paragraphs - split by double newlines
    const blocks = html.split(/\n\n+/);
    html = blocks.map(block => {
        block = block.trim();
        if (!block) return '';
        // Don't wrap if already a tag
        if (block.startsWith('<h') || block.startsWith('<img') || block.startsWith('<ul') || block.startsWith('<ol')) {
            return block;
        }
        return `<p>${block.replace(/\n/g, ' ')}</p>`;
    }).join('\n');

    return html;
}

// Format date for display
function formatDate(dateStr) {
    if (!dateStr) return '';
    // Handle YYYY-MM or YYYY-MM-DD
    const parts = dateStr.split('-');
    if (parts.length === 2) {
        const [year, month] = parts;
        const date = new Date(year, month - 1);
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    } else if (parts.length === 3) {
        const [year, month, day] = parts;
        const date = new Date(year, month - 1, day);
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }
    return dateStr;
}

// Generate project card HTML
function generateProjectCard(project) {
    const { folder, meta, bodyHtml } = project;
    const tags = Array.isArray(meta.tags) ? meta.tags : [];
    const tagsData = tags.join(',');
    const thumbnailPath = meta.thumbnail ? `${folder}/${meta.thumbnail}` : '';
    const dateRange = meta.start_date
        ? (meta.end_date && meta.end_date !== meta.start_date
            ? `${formatDate(meta.start_date)} - ${formatDate(meta.end_date)}`
            : formatDate(meta.start_date))
        : '';

    const slug = folder.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    return `
        <article class="project-card"
                 id="${slug}"
                 data-tags="${tagsData}"
                 data-status="${meta.status || 'completed'}"
                 data-date="${meta.end_date || meta.start_date || ''}">
            <div class="project-card__preview" onclick="toggleProject('${slug}')">
                ${thumbnailPath ? `<img src="${thumbnailPath}" alt="${meta.title}" class="project-thumbnail" loading="lazy">` : '<div class="project-thumbnail-placeholder"></div>'}
                <div class="project-card__info">
                    <h3>${meta.title || folder}</h3>
                    <div class="project-meta">
                        ${dateRange ? `<span class="date">${dateRange}</span>` : ''}
                        <span class="status-badge status-${meta.status || 'completed'}">${meta.status || 'completed'}</span>
                    </div>
                    <div class="project-tags">
                        ${tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
                    </div>
                </div>
                <span class="expand-icon">▼</span>
            </div>
            <div class="project-card__details" id="${slug}-details">
                ${bodyHtml}
            </div>
        </article>`;
}

// Generate filter buttons from all tags
function generateTagFilters(projects) {
    const allTags = new Set();
    for (const p of projects) {
        const tags = Array.isArray(p.meta.tags) ? p.meta.tags : [];
        tags.forEach(t => allTags.add(t));
    }

    const sortedTags = Array.from(allTags).sort();
    return sortedTags.map(tag =>
        `<button class="tag-filter" data-tag="${tag}">${tag}</button>`
    ).join('\n                    ');
}

// Generate full HTML page
function generatePage(projects) {
    const projectCards = projects
        .sort((a, b) => {
            // Sort by end_date descending (most recent first)
            const dateA = a.meta.end_date || a.meta.start_date || '';
            const dateB = b.meta.end_date || b.meta.start_date || '';
            return dateB.localeCompare(dateA);
        })
        .map(generateProjectCard)
        .join('\n');

    const tagFilters = generateTagFilters(projects);
    const today = new Date().toISOString().split('T')[0];

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Projects | Emmet</title>
    <meta name="description" content="Emmet's projects - 3D printing, robotics, and more">
    <link rel="stylesheet" href="./style.css">
</head>
<body>
    <nav class="top-nav">
        <a href="../index.html">🏠 Home</a>
        <a href="../Visual-Stitch/snapshots.html">📹 Daily Snapshots</a>
        <a href="./projects.html" class="active">🛠️ Projects</a>
        <a href="../Puzzle/puzzle.html">🧩 Puzzles</a>
        <a href="../Game_review/games.html">🎮 Game Reviews</a>
        <a href="../Blog/blog.html">📢 Blog</a>
        <a href="../Discipline/discipline.html">🎯 Discipline</a>
    </nav>

    <header class="page-header">
        <h1>What has Emmet worked on?</h1>
        <p class="intro-text">
            A collection of projects I've built, am building, or dream of building someday.
            Click any project to see the full story with progress photos and notes.
        </p>
    </header>

    <div class="container">
        <section class="projects-section">
            <div class="controls">
                <div class="tag-filters">
                    <button class="tag-filter active" data-tag="all">All</button>
                    ${tagFilters}
                </div>
                <select id="sort-by">
                    <option value="date">Sort by Date</option>
                    <option value="name">Sort by Name</option>
                </select>
            </div>

            <div class="project-list" id="project-list">
${projectCards}
            </div>
        </section>

        <footer class="page-footer">
            <p>Last updated: ${today}</p>
        </footer>
    </div>

    <script src="./projects.js"></script>
</body>
</html>
`;
}

// Generate latest-project.json for home page preview
function generateLatestProjectJson(projects) {
    const sorted = [...projects].sort((a, b) => {
        const dateA = a.meta.end_date || a.meta.start_date || '';
        const dateB = b.meta.end_date || b.meta.start_date || '';
        return dateB.localeCompare(dateA);
    });

    if (sorted.length === 0) return;

    const latest = sorted[0];
    const data = {
        title: latest.meta.title || latest.folder,
        thumbnail: latest.meta.thumbnail ? `${latest.folder}/${latest.meta.thumbnail}` : null,
        folder: latest.folder
    };

    const jsonPath = path.join(PROJECTS_DIR, 'latest-project.json');
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`Generated: ${jsonPath}`);
}

// Main build function
function build() {
    console.log('Building projects page...');

    const projectFiles = findProjectFiles();
    console.log(`Found ${projectFiles.length} projects`);

    const projects = [];

    for (const pf of projectFiles) {
        console.log(`  Processing: ${pf.folder}`);
        const content = fs.readFileSync(pf.mdPath, 'utf-8');
        const { meta, body } = parseFrontMatter(content);
        const bodyHtml = markdownToHtml(body, pf.folder);

        projects.push({
            folder: pf.folder,
            meta,
            bodyHtml
        });
    }

    const html = generatePage(projects);
    fs.writeFileSync(OUTPUT_FILE, html, 'utf-8');
    console.log(`\nGenerated: ${OUTPUT_FILE}`);

    generateLatestProjectJson(projects);
}

build();