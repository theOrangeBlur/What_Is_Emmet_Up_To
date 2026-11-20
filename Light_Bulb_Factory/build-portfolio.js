/**
 * Lightbulb Factory portfolio builder
 *
 * Merges the project folders in ../Projects (their process.md front matter)
 * with the hand-written professional copy in portfolio.json, and writes
 * portfolio.generated.json for the factory page's carousel.
 *
 * portfolio.json is yours to edit:
 *   - the order of "projects" is the carousel's order
 *   - "description" is the professional blurb shown on the card
 * A card opens to the project's full process.md write-up, rendered the same
 * way as on the Projects page.
 *   - "title" (optional) overrides the process.md title
 *   - "hidden": true leaves a project out without losing its entry
 * Only finished projects are used (status "completed" or "finished"); any
 * finished project not yet listed is appended as a stub on the next build,
 * so new ones show up automatically. Existing entries are never changed.
 * A listed project whose status goes back to unfinished is skipped.
 *
 * Usage: node Light_Bulb_Factory/build-portfolio.js
 * (Projects/build.js also runs this at the end of its build.)
 */

const fs = require('fs');
const path = require('path');
const { parseFrontMatter, formatDate, findProjectFiles, markdownToHtml } = require('../Projects/build.js');

const FACTORY_DIR = __dirname;
const SOURCE_FILE = path.join(FACTORY_DIR, 'portfolio.json');
const OUTPUT_FILE = path.join(FACTORY_DIR, 'portfolio.generated.json');
const FALLBACK_MAX = 260; // characters of the casual write-up used until a blurb is written

const projectDate = (meta) => meta.end_date || meta.last_work_date || meta.start_date || '';
const slugOf = (folder) => folder.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const asArray = (v) => (Array.isArray(v) ? v : []);
const DONE = new Set(['completed', 'finished', 'done']);
const isDone = (meta) => DONE.has(String(meta.status || '').trim().toLowerCase());

// The first prose paragraph of a process.md, as plain text, shortened at a
// word break. Stands in for the professional description until one is written.
function fallbackDescription(body) {
    const lines = [];
    for (const raw of body.split('\n')) {
        const line = raw.trim();
        if (!line) { if (lines.length) break; continue; }
        if (line.startsWith('#') || line.startsWith('![') || line.startsWith('<')) {
            if (lines.length) break;
            continue;
        }
        lines.push(line);
    }
    const text = lines.join(' ')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // links -> their text
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
    if (text.length <= FALLBACK_MAX) return text;
    const cut = text.slice(0, FALLBACK_MAX);
    return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:.!?-]+$/, '') + '…';
}

// The full write-up, as on the Projects page. Its media paths are relative to
// Projects/, so they're made absolute for the factory page.
function detailsHtml(folder, body) {
    const prefix = `src="${folder}/`;
    return markdownToHtml(body, folder)
        .split(prefix).join(`src="/Projects/${encodeURIComponent(folder)}/`);
}

function dateRange(meta) {
    if (!meta.start_date) return '';
    if (meta.end_date && meta.end_date !== meta.start_date) {
        const a = formatDate(meta.start_date), b = formatDate(meta.end_date);
        return a === b ? a : `${a} – ${b}`;
    }
    return formatDate(meta.start_date);
}

function readSource() {
    if (!fs.existsSync(SOURCE_FILE)) return { projects: [] };
    const data = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf-8'));
    if (!Array.isArray(data.projects)) data.projects = [];
    return data;
}

function buildPortfolio() {
    console.log('Building Lightbulb Factory portfolio...');

    const found = new Map();
    for (const pf of findProjectFiles()) {
        const content = fs.readFileSync(pf.mdPath, 'utf-8').replace(/\r\n/g, '\n');
        const { meta, body } = parseFrontMatter(content);
        if (!isDone(meta)) continue; // still in the works: not shown in the factory
        found.set(pf.folder, { meta, body });
    }

    // Seed any project that isn't listed yet, newest first.
    const source = readSource();
    const listed = new Set(source.projects.map((p) => p.folder));
    const missing = [...found.keys()]
        .filter((folder) => !listed.has(folder))
        .sort((a, b) => projectDate(found.get(b).meta).localeCompare(projectDate(found.get(a).meta)));
    for (const folder of missing) {
        source.projects.push({ folder, title: null, description: '', hidden: false });
    }
    if (missing.length || !fs.existsSync(SOURCE_FILE)) {
        fs.writeFileSync(SOURCE_FILE, JSON.stringify(source, null, 2) + '\n', 'utf-8');
        console.log(`  Added ${missing.length} new project(s) to ${path.basename(SOURCE_FILE)}`);
    }

    const out = [];
    for (const entry of source.projects) {
        const project = found.get(entry.folder);
        if (!project) {
            if (!fs.existsSync(path.join(__dirname, '..', 'Projects', entry.folder, 'process.md'))) {
                console.warn(`  Warning: portfolio.json lists "${entry.folder}", which has no Projects/<folder>/process.md`);
            }
            continue; // missing, or not finished
        }
        if (entry.hidden) continue;
        const { meta, body } = project;
        const folderUrl = '/Projects/' + encodeURIComponent(entry.folder);
        out.push({
            slug: slugOf(entry.folder),
            title: entry.title || meta.title || entry.folder,
            description: (entry.description || '').trim() || fallbackDescription(body),
            dates: dateRange(meta),
            tags: asArray(meta.tags).filter((t) => t && t !== 'Team'),
            thumbnail: meta.thumbnail ? `${folderUrl}/${encodeURI(meta.thumbnail)}` : null,
            details: detailsHtml(entry.folder, body),
        });
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ projects: out }, null, 2) + '\n', 'utf-8');
    console.log(`Generated: ${OUTPUT_FILE} (${out.length} projects)`);
}

module.exports = { buildPortfolio };

if (require.main === module) buildPortfolio();
