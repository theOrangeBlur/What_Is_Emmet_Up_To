/**
 * Projects page interactivity
 * Handles filtering by tags, sorting, and expanding project details
 */

// Full rendered height of the details panel (content + padding + border),
// which is what max-height means under border-box sizing.
function fullHeight(details) {
    return details.scrollHeight + (details.offsetHeight - details.clientHeight);
}

// Toggle project details visibility
function toggleProject(slug) {
    const details = document.getElementById(`${slug}-details`);
    const card = document.getElementById(slug);
    const expand = !details.classList.contains('expanded');

    card.classList.toggle('expanded', expand);

    if (expand) {
        // The vertical padding transitions in with the panel, so measuring
        // mid-transition misses it and clips the bottom (the collapse
        // button). Snap the padding to its final value before measuring.
        details.style.transition = 'none';
        details.classList.add('expanded');
        const height = fullHeight(details);
        details.offsetHeight; // flush styles so the snap takes effect
        details.style.transition = '';
        details.style.maxHeight = height + 'px';
    } else {
        // Coming from max-height: none, so pin the current height first or
        // there's nothing to animate from.
        details.style.maxHeight = fullHeight(details) + 'px';
        details.offsetHeight;
        details.classList.remove('expanded');
        details.style.maxHeight = '0px';
    }
}

// Once the reveal finishes, drop the fixed max-height so the panel tracks
// its content: late-loading images/videos and window resizes (which re-wrap
// the media rows) can't leave the bottom clipped.
function initDetailsRelease() {
    document.querySelectorAll('.project-card__details').forEach(details => {
        details.addEventListener('transitionend', e => {
            if (e.target === details && e.propertyName === 'max-height' &&
                details.classList.contains('expanded')) {
                details.style.maxHeight = 'none';
            }
        });
    });
}

function initSteppers() {
    document.querySelectorAll('.step-stepper').forEach(stepper => {
        const stage = stepper.querySelector('.step-stepper__stage');
        const imgs = stepper.querySelectorAll('.step-stepper__img');
        const counter = stepper.querySelector('.step-stepper__counter');
        const hint = stepper.querySelector('.step-stepper__hint');
        let current = 0;

        imgs[0].classList.add('active');

        // Preload all step images immediately so first-run is smooth
        imgs.forEach(img => { img.loading = 'eager'; });

        function updateUI() {
            counter.textContent = `Step ${current + 1} / ${imgs.length}`;
            hint.textContent = current === imgs.length - 1 ? 'click to restart' : 'click to advance';
        }

        stage.addEventListener('click', () => {
            imgs[current].classList.remove('active');
            current = (current + 1) % imgs.length;
            imgs[current].classList.add('active');
            updateUI();
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initSteppers();
    initDetailsRelease();
    const projectList = document.getElementById('project-list');
    const sortSelect = document.getElementById('sort-by');
    const tagFilters = document.querySelectorAll('.tag-filter');

    if (!projectList) return;

    const projects = Array.from(projectList.querySelectorAll('.project-card'));

    // Store original order for date sorting
    projects.forEach((project, index) => {
        project.dataset.originalIndex = index;
    });

    let activeTag = 'all';

    function applyFiltersAndSort() {
        const sortBy = sortSelect ? sortSelect.value : 'date';

        // Filter by tag
        projects.forEach(project => {
            const tags = project.dataset.tags ? project.dataset.tags.split(',') : [];
            const visible = activeTag === 'all' || tags.includes(activeTag);
            project.style.display = visible ? '' : 'none';
        });

        // Get visible projects for sorting
        const visibleProjects = projects.filter(p => p.style.display !== 'none');

        // Sort
        visibleProjects.sort((a, b) => {
            switch (sortBy) {
                case 'name':
                    const nameA = a.querySelector('h3').textContent || '';
                    const nameB = b.querySelector('h3').textContent || '';
                    return nameA.localeCompare(nameB);
                case 'date':
                default:
                    // Original order is by date (most recent first)
                    return parseInt(a.dataset.originalIndex) - parseInt(b.dataset.originalIndex);
            }
        });

        // Reorder DOM elements
        visibleProjects.forEach(project => projectList.appendChild(project));
    }

    // Tag filter click handlers
    tagFilters.forEach(btn => {
        btn.addEventListener('click', () => {
            // Update active state
            tagFilters.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            activeTag = btn.dataset.tag;
            applyFiltersAndSort();
        });
    });

    // Sort change handler
    if (sortSelect) {
        sortSelect.addEventListener('change', applyFiltersAndSort);
    }
});
