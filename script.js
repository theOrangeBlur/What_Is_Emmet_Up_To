// Splash texts (Minecraft style)
const splashTexts = [
    "I'm sorry I haven't called you back yet!!!",
    "Ferb, I know what I'm gonna do today!",
    "I'll be a 10x engineer one day",
    "This statement is bananas",
    "How will future generations define us?",
    "Did he post a new pick? OMG!",
    "The most productive unemployment the world has ever seen!",
    "My mom's favorite website!",
    "Contains 100% real Emmet!",
    "Now in {get_backround_color()}!",
    "Frequently*** updated!",
    "Thank you for the cookies! Om nom nom",
    "May contain puzzles!",
    "Riddle me to bits!",
    "More fun than calling me! -my AI",
    "Yesterday I said tomorrow!",
    "Maybe today is the day I get into coffee",
    "Your one-stop Emmet shop!",
    "Do newline chars work?<br \>test<br \>test!",
    "'Whimsineering'",
    "I'm not on social media, but I have this...?",
    "This one's for you, beloved friend/family member!",
    "Odds of me picking up your call today... 68%. New record!",
    "Please don't read the code",
    "I haven't had to find an eigenvalue in ages. Have you?",
    "I'm sorry I left you on read again, I really am.",
    "Early bird gets the worm, but the second mouse gets the cheese.",
    "Slicker than snot on a door knob!",
    "CONSTANT VIGILANCE!!!",
    "'While My Guitar Gently Weeps' is the best Beatles song, change my mind.",
    "Who you gonna call?",
    "Yes, I really sat down and wrote a bunch of these out.",
    "You should see the ones my AI wrote (Claude, don't read this)",
    "Maybe he's in a cave!",
    "No recursion required.",
    "YEEEEEWWWWWW!! He's on the slopes!!",
    "Dude I think this song really is about me!",
    "Voted most likely person to break a bone on this trip"
];

// Simple seeded random number generator
function seededRandom(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

// Convert date string to a numeric seed
function dateToSeed(dateString) {
    // Convert YYYY-MM-DD to a number (e.g., "2026-01-13" -> 20260113)
    return parseInt(dateString.replace(/-/g, ''));
}

// Daily splash text with 30-day history tracking
function getDailySplashText() {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

    // Get splash history from localStorage
    let splashHistory = [];
    try {
        const stored = localStorage.getItem('splashHistory');
        if (stored) {
            splashHistory = JSON.parse(stored);
        }
    } catch (e) {
        console.error('Error loading splash history:', e);
    }

    // Check if we already picked today's splash
    const todayEntry = splashHistory.find(entry => entry.date === today);
    if (todayEntry) {
        return todayEntry.text;
    }

    // Clean history - keep only last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    splashHistory = splashHistory.filter(entry => {
        return new Date(entry.date) > thirtyDaysAgo;
    });

    // Get texts used in last 30 days
    const recentTexts = splashHistory.map(entry => entry.text);

    // Get available texts (not used recently)
    let availableTexts = splashTexts.filter(text => !recentTexts.includes(text));

    // If all texts have been used, reset and use any text
    if (availableTexts.length === 0) {
        availableTexts = splashTexts;
    }

    // Use date-seeded random to pick text (everyone sees same text on same day)
    const seed = dateToSeed(today);
    const randomIndex = Math.floor(seededRandom(seed) * availableTexts.length);
    const randomText = availableTexts[randomIndex];

    // Save to history
    splashHistory.push({
        date: today,
        text: randomText
    });

    // Save to localStorage
    try {
        localStorage.setItem('splashHistory', JSON.stringify(splashHistory));
    } catch (e) {
        console.error('Error saving splash history:', e);
    }

    return randomText;
}

// Set the splash text
const splash = document.getElementById('splashText');
splash.textContent = getDailySplashText();

// Custom cursor
const cursor = document.querySelector('.custom-cursor');
const trails = [];
const maxTrails = 5;

for (let i = 0; i < maxTrails; i++) {
    const trail = document.createElement('div');
    trail.className = 'cursor-trail';
    document.body.appendChild(trail);
    trails.push({
        element: trail,
        x: 0,
        y: 0
    });
}

let mouseX = 0, mouseY = 0;
let cursorX = 0, cursorY = 0;

document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
});

function animateCursor() {
    cursorX += (mouseX - cursorX) * 0.2;
    cursorY += (mouseY - cursorY) * 0.2;

    cursor.style.left = cursorX + 'px';
    cursor.style.top = cursorY + 'px';

    trails.forEach((trail, index) => {
        const delay = (index + 1) * 0.05;
        trail.x += (mouseX - trail.x) * (0.2 - delay);
        trail.y += (mouseY - trail.y) * (0.2 - delay);
        trail.element.style.left = trail.x + 'px';
        trail.element.style.top = trail.y + 'px';
        trail.element.style.opacity = 1 - (index / maxTrails);
    });

    requestAnimationFrame(animateCursor);
}

animateCursor();

// Floating particles
function createParticle() {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.left = Math.random() * window.innerWidth + 'px';
    particle.style.top = Math.random() * window.innerHeight + 'px';
    particle.style.animationDelay = Math.random() * 3 + 's';
    particle.style.animationDuration = (Math.random() * 3 + 2) + 's';
    document.body.appendChild(particle);

    setTimeout(() => particle.remove(), 6000);
}

setInterval(createParticle, 500);
for (let i = 0; i < 15; i++) createParticle();
