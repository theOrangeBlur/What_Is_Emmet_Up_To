/**
 * Projects page interactivity
 * Handles filtering by tags, sorting, and expanding project details
 */

// Set the details panel's max-height to fit its content exactly, so the
// reveal isn't capped by a guessed pixel value (long write-ups got clipped)
// or left at 0 forever (a sliver of text peeking through when collapsed).
function measureDetails(details) {
    details.style.maxHeight = details.scrollHeight + 'px';
}

// Toggle project details visibility
function toggleProject(slug) {
    const details = document.getElementById(`${slug}-details`);
    const card = document.getElementById(slug);
    const expand = !details.classList.contains('expanded');

    details.classList.toggle('expanded', expand);
    card.classList.toggle('expanded', expand);

    if (expand) {
        measureDetails(details);
        // Images/videos in the write-up can finish loading after this
        // measurement and grow the card, so re-measure once they're in.
        details.querySelectorAll('img, video').forEach(el => {
            const ready = el.tagName === 'VIDEO' ? el.readyState >= 1 : el.complete;
            if (!ready) {
                const evt = el.tagName === 'VIDEO' ? 'loadedmetadata' : 'load';
                el.addEventListener(evt, () => {
                    if (details.classList.contains('expanded')) {
                        measureDetails(details);
                    }
                }, { once: true });
            }
        });
    } else {
        details.style.maxHeight = '0px';
    }
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
