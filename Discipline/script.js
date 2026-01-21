// Discipline Tracker - Calendar Script

let disciplineData = {};
let currentDate = new Date();

// Minimum date (January 2026)
const MIN_YEAR = 2026;
const MIN_MONTH = 0; // January (0-indexed)

// Dance animation state
let danceInterval = null;

// Load and parse CSV data
async function loadDisciplineData() {
    try {
        const response = await fetch('./log.csv');
        const csvText = await response.text();
        parseCsvData(csvText);
        renderCalendar();
        startDanceAnimation();
    } catch (error) {
        console.error('Error loading discipline data:', error);
        renderCalendar();
        startDanceAnimation();
    }
}

// Parse CSV into structured data
function parseCsvData(csvText) {
    const lines = csvText.trim().split('\n');
    // Skip header row
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const [date, category, action] = line.split(',').map(s => s.trim());
        if (!date || !category || !action) continue;

        // Normalize the date format to YYYY-MM-DD
        const normalizedDate = normalizeDate(date);
        if (!normalizedDate) continue;

        if (!disciplineData[normalizedDate]) {
            disciplineData[normalizedDate] = {
                mind: [],
                body: [],
                spirit: []
            };
        }

        const categoryLower = category.toLowerCase();
        if (disciplineData[normalizedDate][categoryLower]) {
            disciplineData[normalizedDate][categoryLower].push(action);
        }
    }
}

// Normalize date from various formats to YYYY-MM-DD
function normalizeDate(dateStr) {
    // Try MM/DD/YYYY format first
    const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
        const [, month, day, year] = slashMatch;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    // Try YYYY-MM-DD format
    const dashMatch = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (dashMatch) {
        const [, year, month, day] = dashMatch;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    return null;
}

// Check if we're at the minimum month
function isAtMinMonth() {
    return currentDate.getFullYear() === MIN_YEAR && currentDate.getMonth() === MIN_MONTH;
}

// Update navigation button states
function updateNavButtons() {
    const prevBtn = document.getElementById('prevMonth');
    if (isAtMinMonth()) {
        prevBtn.classList.add('disabled');
        prevBtn.disabled = true;
    } else {
        prevBtn.classList.remove('disabled');
        prevBtn.disabled = false;
    }
}

// Render the calendar for the current month
function renderCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    // Update header
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];
    document.getElementById('monthYear').textContent = `${monthNames[month]} ${year}`;

    // Update nav button states
    updateNavButtons();

    // Get first day of month and total days
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    // Today's date for highlighting
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // Build calendar HTML
    const calendarDays = document.getElementById('calendarDays');
    calendarDays.innerHTML = '';

    // Previous month's days
    for (let i = firstDay - 1; i >= 0; i--) {
        const day = daysInPrevMonth - i;
        const prevMonth = month === 0 ? 12 : month;
        const prevYear = month === 0 ? year - 1 : year;
        const dateStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        calendarDays.appendChild(createDayCell(day, dateStr, true));
    }

    // Current month's days
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isToday = dateStr === todayStr;
        calendarDays.appendChild(createDayCell(day, dateStr, false, isToday));
    }

    // Next month's days to fill the grid
    const totalCells = firstDay + daysInMonth;
    const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let day = 1; day <= remainingCells; day++) {
        const nextMonth = month === 11 ? 1 : month + 2;
        const nextYear = month === 11 ? year + 1 : year;
        const dateStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        calendarDays.appendChild(createDayCell(day, dateStr, true));
    }
}

// Check if a date is in the past (before today)
function isPastDate(dateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [year, month, day] = dateStr.split('-').map(Number);
    const checkDate = new Date(year, month - 1, day);
    return checkDate < today;
}

// Create a single day cell
function createDayCell(day, dateStr, isOtherMonth, isToday = false) {
    const cell = document.createElement('div');
    cell.className = 'day-cell';
    cell.setAttribute('data-date', dateStr);

    if (isOtherMonth) cell.classList.add('other-month');
    if (isToday) cell.classList.add('today');
    if (isPastDate(dateStr) && !isToday) cell.classList.add('past-day');

    const dayNumber = document.createElement('div');
    dayNumber.className = 'day-number';
    dayNumber.textContent = day;
    cell.appendChild(dayNumber);

    const dots = document.createElement('div');
    dots.className = 'day-dots';

    const dayData = disciplineData[dateStr] || { mind: [], body: [], spirit: [] };

    // Mind dot
    dots.appendChild(createDot('mind', dayData.mind));
    // Body dot
    dots.appendChild(createDot('body', dayData.body));
    // Spirit dot
    dots.appendChild(createDot('spirit', dayData.spirit));

    cell.appendChild(dots);
    return cell;
}

// Create a discipline dot with tooltip
function createDot(category, activities) {
    const dot = document.createElement('div');
    dot.className = `dot ${category}`;

    if (activities && activities.length > 0) {
        dot.classList.add('filled');

        const tooltip = document.createElement('div');
        tooltip.className = 'dot-tooltip';
        tooltip.textContent = activities.join(', ');
        dot.appendChild(tooltip);
    }

    return dot;
}

// Navigation handlers
document.getElementById('prevMonth').addEventListener('click', () => {
    if (!isAtMinMonth()) {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar();
        restartDanceAnimation();
    }
});

document.getElementById('nextMonth').addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar();
    restartDanceAnimation();
});

// Dance animation for filled dots
function startDanceAnimation() {
    if (danceInterval) {
        clearInterval(danceInterval);
        danceInterval = null;
    }

    // Get all filled dots in calendar order
    function getFilledDots() {
        const dots = [];
        const dayCells = document.querySelectorAll('#calendarDays .day-cell:not(.other-month)');
        dayCells.forEach(cell => {
            const filledDots = cell.querySelectorAll('.dot.filled');
            filledDots.forEach(dot => dots.push(dot));
        });
        return dots;
    }

    let currentIndex = 0;
    let isPaused = false;

    function danceNextDot() {
        if (isPaused) return;

        const dots = getFilledDots();
        if (dots.length === 0) return;

        // If we've gone through all dots, pause for 3 seconds then restart
        if (currentIndex >= dots.length) {
            isPaused = true;
            setTimeout(() => {
                currentIndex = 0;
                isPaused = false;
            }, 3000);
            return;
        }

        const dot = dots[currentIndex];
        dot.classList.add('dancing');

        // Remove the class after animation completes
        setTimeout(() => {
            dot.classList.remove('dancing');
        }, 300);

        currentIndex++;
    }

    // Start the dance cycle - trigger every 100ms for wave effect
    danceInterval = setInterval(danceNextDot, 100);
}

function restartDanceAnimation() {
    startDanceAnimation();
}

// Initialize
document.addEventListener('DOMContentLoaded', loadDisciplineData);
