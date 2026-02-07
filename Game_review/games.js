/**
 * Game list filtering and sorting (progressive enhancement)
 * The page works without JavaScript - this adds interactivity
 */

document.addEventListener('DOMContentLoaded', () => {
    const gameList = document.getElementById('game-list');
    const sortSelect = document.getElementById('sort-by');
    const filterSelect = document.getElementById('filter-status');

    if (!gameList || !sortSelect || !filterSelect) return;

    const games = Array.from(gameList.querySelectorAll('.game-card'));

    // Store original order for date sorting
    games.forEach((game, index) => {
        game.dataset.originalIndex = index;
    });

    function applyFiltersAndSort() {
        const sortBy = sortSelect.value;
        const filterStatus = filterSelect.value;

        // Filter
        games.forEach(game => {
            const status = game.dataset.status;
            const visible = filterStatus === 'all' || status === filterStatus;
            game.style.display = visible ? '' : 'none';
        });

        // Get visible games for sorting
        const visibleGames = games.filter(g => g.style.display !== 'none');

        // Sort
        visibleGames.sort((a, b) => {
            switch (sortBy) {
                case 'hours':
                    return parseFloat(b.dataset.hours || 0) - parseFloat(a.dataset.hours || 0);
                case 'name':
                    return (a.dataset.name || '').localeCompare(b.dataset.name || '');
                case 'date':
                default:
                    // Sort by play order (most recently played first)
                    return parseInt(b.dataset.playOrder || 0) - parseInt(a.dataset.playOrder || 0);
            }
        });

        // Reorder DOM elements
        visibleGames.forEach(game => gameList.appendChild(game));
    }

    sortSelect.addEventListener('change', applyFiltersAndSort);
    filterSelect.addEventListener('change', applyFiltersAndSort);
});
