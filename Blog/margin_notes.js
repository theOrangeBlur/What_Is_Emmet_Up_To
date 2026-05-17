(function () {
    var MIN_WIDTH = 1100;

    function pickRandom(arr, n) {
        var pool = arr.slice();
        var result = [];
        while (result.length < n && pool.length > 0) {
            var i = Math.floor(Math.random() * pool.length);
            result.push(pool.splice(i, 1)[0]);
        }
        return result;
    }

    function buildNote(item, side) {
        var el = document.createElement('aside');
        el.className = 'margin-note ' + side;

        var label = document.createElement('span');
        label.className = 'note-label';
        label.textContent = item.type === 'thought' ? 'shower thought' : 'fun fact';
        el.appendChild(label);

        var text = document.createElement('p');
        text.className = 'note-text';
        text.textContent = item.text;
        el.appendChild(text);

        if (item.source) {
            var src = document.createElement('a');
            src.className = 'note-source';
            src.href = item.source;
            src.target = '_blank';
            src.rel = 'noopener';
            src.textContent = 'source';
            el.appendChild(src);
        }

        return el;
    }

    function placeNotes() {
        document.querySelectorAll('.margin-note').forEach(function (n) { n.remove(); });

        if (window.innerWidth < MIN_WIDTH) return;

        var data = window.MARGIN_DATA || { facts: [], thoughts: [] };
        var all = data.facts.map(function (f) {
            return { text: f.text, source: f.source, type: 'fact' };
        }).concat(data.thoughts.map(function (t) {
            return { text: t, source: null, type: 'thought' };
        }));

        if (all.length === 0) return;

        var picks = pickRandom(all, 2);
        ['left', 'right'].forEach(function (side, i) {
            if (picks[i]) {
                document.body.appendChild(buildNote(picks[i], side));
            }
        });
    }

    window.addEventListener('load', placeNotes);

    var resizeTimer;
    window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(placeNotes, 200);
    });
})();
