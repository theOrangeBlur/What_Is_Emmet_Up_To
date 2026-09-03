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

    // Set the details panel's max-height to fit its content exactly, so the
    // reveal isn't capped by a guessed pixel value (long reviews got clipped)
    // or left at 0 forever (a sliver of text peeking through when collapsed).
    function setCardExpanded(card, expand) {
        const details = card.querySelector('.game-card__details');
        card.classList.toggle('expanded', expand);
        if (!details) return;
        details.style.maxHeight = expand ? details.scrollHeight + 'px' : '0px';
    }

    // Click to expand/collapse reviews
    gameList.addEventListener('click', (e) => {
        const card = e.target.closest('.game-card.expandable');
        if (!card) return;
        if (e.target.tagName === 'A') return;
        setCardExpanded(card, !card.classList.contains('expanded'));
    });

    function applyFiltersAndSort() {
        const sortBy = sortSelect.value;
        const filterStatus = filterSelect.value;

        // Collapse all expanded cards on filter/sort change
        games.forEach(game => {
            const status = game.dataset.status;
            const visible = filterStatus === 'all' || status === filterStatus;
            game.style.display = visible ? '' : 'none';
            setCardExpanded(game, false);
        });

        // Get visible games for sorting
        const visibleGames = games.filter(g => g.style.display !== 'none');

        // Sort
        visibleGames.sort((a, b) => {
            switch (sortBy) {
                case 'hours':
                    return parseFloat(b.dataset.hours || 0) - parseFloat(a.dataset.hours || 0);
                case 'rating':
                    return parseFloat(b.dataset.rating || 0) - parseFloat(a.dataset.rating || 0);
                case 'name':
                    return (a.dataset.name || '').localeCompare(b.dataset.name || '');
                case 'date':
                default:
                    // Sort by date last played (most recent first)
                    return (b.dataset.dateLastPlayed || '').localeCompare(a.dataset.dateLastPlayed || '');
            }
        });

        // Reorder DOM elements
        visibleGames.forEach(game => gameList.appendChild(game));
    }

    sortSelect.addEventListener('change', applyFiltersAndSort);
    filterSelect.addEventListener('change', applyFiltersAndSort);

    applyFiltersAndSort();
});
