/**
 * Movie Reviews Page - Sorting, Filtering, and Expand/Collapse
 */

document.addEventListener('DOMContentLoaded', () => {
    const sortSelect = document.getElementById('sort-by');
    const filterSelect = document.getElementById('filter-rating');
    const directorSelect = document.getElementById('filter-director');
    const movieGrid = document.getElementById('movie-grid');

    if (!movieGrid) return;

    // Get all movie cards
    const getMovieCards = () => Array.from(movieGrid.querySelectorAll('.movie-card'));

    // ============================================
    // FIVE-STAR DANCE ANIMATION
    // ============================================
    let danceTimeout = null;

    // Animation timing: 0.2s (last star delay) + 0.3s (animation) + small buffer
    const WAVE_DURATION = 550; // ms for one card's wave to complete
    const END_OF_LIST_PAUSE = 5000; // 5 second pause at end of list

    function startFiveStarDance() {
        // Clear any existing dance
        if (danceTimeout) {
            clearTimeout(danceTimeout);
        }

        let currentIndex = 0;

        function danceNext() {
            // Get current visible 5-star cards (may have changed due to filtering)
            const visibleCards = Array.from(
                movieGrid.querySelectorAll('.movie-card.five-star:not([style*="display: none"])')
            );
            if (visibleCards.length === 0) {
                danceTimeout = setTimeout(danceNext, 2000);
                return;
            }

            // Add dancing class to current card
            const card = visibleCards[currentIndex];
            if (card) {
                card.classList.add('dancing');

                // Remove after animation completes
                setTimeout(() => {
                    card.classList.remove('dancing');
                }, 500);
            }

            // Move to next card
            currentIndex++;

            // Check if we've reached the end of the list
            if (currentIndex >= visibleCards.length) {
                // Reset to beginning and pause for 5 seconds
                currentIndex = 0;
                danceTimeout = setTimeout(danceNext, END_OF_LIST_PAUSE);
            } else {
                // Move to next card immediately after wave completes
                danceTimeout = setTimeout(danceNext, WAVE_DURATION);
            }
        }

        // Start after a short delay
        danceTimeout = setTimeout(danceNext, 1500);
    }

    // Start the dance
    startFiveStarDance();

    // ============================================
    // EXPAND/COLLAPSE FUNCTIONALITY
    // ============================================

    // Add click handlers to expandable cards
    movieGrid.addEventListener('click', (e) => {
        const card = e.target.closest('.movie-card.expandable');
        if (!card) return;

        // Don't toggle if clicking a link
        if (e.target.tagName === 'A') return;

        // Toggle expanded state
        card.classList.toggle('expanded');
    });

    // ============================================
    // SORTING AND FILTERING
    // ============================================

    // Sort functions
    const sortFunctions = {
        'date-desc': (a, b) => {
            const dateA = a.dataset.date || '';
            const dateB = b.dataset.date || '';
            return dateB.localeCompare(dateA);
        },
        'date-asc': (a, b) => {
            const dateA = a.dataset.date || '';
            const dateB = b.dataset.date || '';
            return dateA.localeCompare(dateB);
        },
        'rating-desc': (a, b) => {
            const ratingA = parseFloat(a.dataset.rating) || 0;
            const ratingB = parseFloat(b.dataset.rating) || 0;
            return ratingB - ratingA;
        },
        'rating-asc': (a, b) => {
            const ratingA = parseFloat(a.dataset.rating) || 0;
            const ratingB = parseFloat(b.dataset.rating) || 0;
            return ratingA - ratingB;
        },
        'name': (a, b) => {
            const nameA = a.dataset.name || '';
            const nameB = b.dataset.name || '';
            return nameA.localeCompare(nameB);
        }
    };

    // Apply sort and filter
    const applyFilters = () => {
        const sortBy = sortSelect ? sortSelect.value : 'date-desc';
        const filterRating = filterSelect ? filterSelect.value : 'all';
        const filterDirector = directorSelect ? directorSelect.value : 'all';
        const cards = getMovieCards();

        // Sort cards
        const sortFn = sortFunctions[sortBy];
        if (sortFn) {
            cards.sort(sortFn);
        }

        // Clear and re-append in new order
        cards.forEach(card => {
            // Filter by rating
            const rating = parseFloat(card.dataset.rating) || 0;
            const director = card.dataset.director || '';
            let visible = true;

            // Rating filter
            if (filterRating === '5') {
                visible = rating === 5;
            } else if (filterRating === '4') {
                visible = rating >= 4;
            } else if (filterRating === '3') {
                visible = rating >= 3;
            }

            // Director filter
            if (visible && filterDirector !== 'all') {
                visible = director === filterDirector;
            }

            card.style.display = visible ? '' : 'none';

            // Collapse when filtering/sorting
            card.classList.remove('expanded');

            movieGrid.appendChild(card);
        });
    };

    // Event listeners for controls
    if (sortSelect) {
        sortSelect.addEventListener('change', applyFilters);
    }
    if (filterSelect) {
        filterSelect.addEventListener('change', applyFilters);
    }
    if (directorSelect) {
        directorSelect.addEventListener('change', applyFilters);
    }
});
