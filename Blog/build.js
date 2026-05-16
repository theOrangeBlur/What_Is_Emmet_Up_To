/**
 * Blog page builder
 * Reads .md files from the Blog folder and generates blog.html
 *
 * Usage: node build.js
 */

const fs = require('fs');
const path = require('path');

const BLOG_DIR = __dirname;
const OUTPUT_FILE = path.join(BLOG_DIR, 'blog.html');

function findPostFiles() {
    return fs.readdirSync(BLOG_DIR)
        .filter(f => f.endsWith('.md') && f !== 'template.md')
        .map(f => path.join(BLOG_DIR, f));
}

function parseFrontMatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) return { meta: {}, body: content };

    const yamlStr = match[1];
    const body = match[2];
    const meta = {};

    for (const line of yamlStr.split(/\r?\n/)) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
        meta[key] = value;
    }

    return { meta, body };
}

function markdownToHtml(md) {
    let html = md;

    // Images/videos: ![alt](path) -> <img> or <video> for .mp4
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
        if (src.match(/\.mp4$/i)) {
            return `<video src="${src}" class="post-image" controls loop muted playsinline></video>`;
        }
        return `<div class="photo-frame"><span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span><img src="${src}" alt="${alt}" class="post-image" loading="lazy"></div>`;
    });

    // Links: [text](url) -> <a>
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // Headers
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');

    // Bold and italic
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Paragraphs — split by double newlines, skip structural/media tags
    const blocks = html.split(/\n\n+/);
    html = blocks.map(block => {
        block = block.trim();
        if (!block) return '';
        if (block.startsWith('<h') || block.startsWith('<ul') || block.startsWith('<ol') ||
            block.startsWith('<div') || block.startsWith('<img') || block.startsWith('<video')) {
            return block;
        }
        return `<p>${block.replace(/\n/g, ' ')}</p>`;
    }).join('\n');

    return html;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length >= 3) {
        const date = new Date(parts[0], parts[1] - 1, parts[2]);
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } else if (parts.length === 2) {
        const date = new Date(parts[0], parts[1] - 1);
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    }
    return dateStr;
}

function generatePostHtml(post) {
    const { meta, bodyHtml } = post;
    const slug = (meta.title || 'post').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `    <article class="blog-post" id="${slug}">
        <header class="post-header">
            <h2 class="post-title">${meta.title || 'Untitled'}</h2>
            ${meta.date ? `<time class="post-date">${formatDate(meta.date)}</time>` : ''}
        </header>
        <div class="post-body">
            ${bodyHtml}
        </div>
    </article>`;
}

function generatePage(posts) {
    const sorted = posts.sort((a, b) => (b.meta.date || '').localeCompare(a.meta.date || ''));
    const postHtmls = sorted.map(generatePostHtml).join('\n\n    <hr class="post-divider">\n\n');
    const today = new Date().toISOString().split('T')[0];

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Blog | Emmet</title>
    <meta name="description" content="What's on Emmet's mind">
    <link rel="apple-touch-icon" sizes="180x180" href="/media/favicon/apple-touch-icon.png">
    <link rel="icon" type="image/png" sizes="32x32" href="/media/favicon/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/media/favicon/favicon-16x16.png">
    <link rel="manifest" href="/media/favicon/site.webmanifest">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Special+Elite&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="./style.css">
</head>
<body>
    <nav class="top-nav">
        <a href="../index.html">Take me home, please!</a>
    </nav>

    <header class="page-header">
        <h1>What's on Emmet's mind?</h1>
    </header>

    <main class="container">
        ${postHtmls || '<p class="no-posts">No posts yet — check back soon!</p>'}
    </main>

    <footer class="page-footer">
        <p>Last updated: ${today}</p>
    </footer>
    <script>
        window.addEventListener('load', function () {
            var lh = 36;
            document.querySelectorAll('.photo-frame').forEach(function (frame) {
                frame.style.paddingBottom = '';
                var cs = getComputedStyle(frame);
                var totalH = frame.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
                var rem = totalH % lh;
                if (rem !== 0) {
                    frame.style.paddingBottom = (parseFloat(cs.paddingBottom) + lh - rem) + 'px';
                }
            });
        });
    </script>
</body>
</html>
`;
}

function build() {
    console.log('Building blog...');
    const postFiles = findPostFiles();
    console.log(`Found ${postFiles.length} post(s)`);

    const posts = [];
    for (const filePath of postFiles) {
        const filename = path.basename(filePath);
        console.log(`  Processing: ${filename}`);
        const content = fs.readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');
        const { meta, body } = parseFrontMatter(content);
        const bodyHtml = markdownToHtml(body);
        posts.push({ filename, meta, bodyHtml });
    }

    const html = generatePage(posts);
    fs.writeFileSync(OUTPUT_FILE, html, 'utf-8');
    console.log(`\nGenerated: ${OUTPUT_FILE}`);
}

build();
