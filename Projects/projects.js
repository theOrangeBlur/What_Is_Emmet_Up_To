/**
 * Projects page interactivity
 * Handles filtering by tags, sorting, and expanding project details
 */

// Toggle project details visibility
function toggleProject(slug) {
    const details = document.getElementById(`${slug}-details`);
    const card = document.getElementById(slug);

    if (details.classList.contains('expanded')) {
        details.classList.remove('expanded');
        card.classList.remove('expanded');
    } else {
        details.classList.add('expanded');
        card.classList.add('expanded');
    }
}

document.addEventListener('DOMContentLoaded', () => {
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
