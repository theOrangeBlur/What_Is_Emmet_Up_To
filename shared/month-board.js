// Monthly standings for the daily puzzles (supabase/leaderboards.sql).
// Load after auth.js and auth-widget.js. Pages call:
//   MonthBoard.mount(root, game, drawDay)  today/month toggle; drawDay(el) draws the daily board into el
//   MonthBoard.championId(game)            last month's winner's user id, or null
//   MonthBoard.crown()                     a 👑 to put after a champion's name
//   MonthBoard.announce(game)              once a month, a card naming last month's champion
// game is 'wordle' or 'thermo'. Everything fails quietly: no network, no board.

window.MonthBoard = (function () {
  const GAME_NAMES = { wordle: 'Final Wordle', thermo: 'Thermometers' };
  const championCache = new Map(); // game -> Promise<row|null>

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Same EST day boundary as the puzzles' getDayKey / dayKey.
  function currentMonth() {
    const d = new Date(Date.now() - 5 * 60 * 60 * 1000);
    return d.getUTCFullYear() * 100 + d.getUTCMonth() + 1;
  }

  function monthName(month) {
    const d = new Date(Date.UTC(Math.floor(month / 100), (month % 100) - 1, 1));
    return d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }).toLowerCase();
  }

  function daysLeft() {
    const now = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    return Math.max(1, Math.ceil((next - now.getTime()) / 86400000));
  }

  async function call(name, args) {
    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return null;
    try {
      if (window.Auth && window.Auth.rpc) {
        const { data, error } = await window.Auth.rpc(name, args);
        return error ? null : data;
      }
      const res = await fetch(`${window.SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          apikey: window.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${window.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args),
      });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  async function myUserId() {
    if (!window.Auth) return null;
    try {
      const s = await window.Auth.getSession();
      return s ? s.user.id : null;
    } catch {
      return null;
    }
  }

  async function usernames(ids) {
    if (!window.Auth || !window.Auth.usernamesFor) return new Map();
    try {
      return await window.Auth.usernamesFor(ids);
    } catch {
      return new Map();
    }
  }

  function nameNode(name, userId, names) {
    const username = userId ? names.get(userId) : null;
    return window.AuthWidget ? window.AuthWidget.profileLink(username, name) : document.createTextNode(name);
  }

  function champion(game) {
    if (!championCache.has(game)) {
      championCache.set(game, call('get_monthly_champion', { p_game: game }).then((rows) => (rows && rows[0]) || null));
    }
    return championCache.get(game);
  }

  async function championId(game) {
    const c = await champion(game);
    return c ? c.user_id : null;
  }

  function crown() {
    const c = el('span', 'mb-crown', '👑');
    c.title = "last month's champion";
    return c;
  }

  function banner(champ, names) {
    const b = el('div', 'mb-champ');
    b.appendChild(el('span', 'mb-champ-label', `👑 ${monthName(champ.month)} champion`));
    const who = el('span', 'mb-champ-name');
    who.appendChild(nameNode(champ.name, champ.user_id, names));
    b.appendChild(who);
    b.appendChild(el('span', 'mb-champ-pts', `${champ.points} pts`));
    return b;
  }

  async function renderMonth(root) {
    const game = root.dataset.mbGame;
    root.innerHTML = '<div class="lb-loading">loading standings...</div>';
    const [rows, champ, me] = await Promise.all([
      call('get_monthly_standings', { p_game: game, p_month: null }),
      champion(game),
      myUserId(),
    ]);
    const standings = rows || [];
    const names = await usernames([...standings.map((r) => r.user_id), champ && champ.user_id]);
    root.innerHTML = '';
    if (champ) root.appendChild(banner(champ, names));
    root.appendChild(el('div', 'lb-title', `${monthName(currentMonth())} standings`));
    const left = daysLeft();
    root.appendChild(el('div', 'mb-sub', `resets in ${left} day${left === 1 ? '' : 's'} · sign in to compete`));
    if (!standings.length) {
      root.appendChild(el('div', 'lb-empty', rows ? 'no signed-in scores yet this month' : "couldn't load standings"));
      return;
    }
    const table = el('table', 'lb-table mb-table');
    const head = el('tr', 'lb-header');
    ['#', 'NAME', 'DAYS', 'WINS', 'PTS'].forEach((h) => head.appendChild(el('th', '', h)));
    table.appendChild(head);
    standings.forEach((r, i) => {
      const tr = el('tr', 'lb-row' + (me && r.user_id === me ? ' mine' : ''));
      tr.appendChild(el('td', '', String(i + 1)));
      const nameTd = el('td');
      nameTd.appendChild(nameNode(r.name, r.user_id, names));
      if (champ && r.user_id === champ.user_id) nameTd.appendChild(crown());
      tr.appendChild(nameTd);
      tr.appendChild(el('td', '', String(r.days_played)));
      tr.appendChild(el('td', '', String(r.wins)));
      tr.appendChild(el('td', 'mb-pts', String(r.points)));
      table.appendChild(tr);
    });
    root.appendChild(table);
  }

  // The view ('day' | 'month') lives on the root, so a page redrawing its
  // daily board after a solve stays on whichever tab the visitor picked.
  function mount(root, game, drawDay) {
    if (!root) return Promise.resolve();
    root.dataset.mbGame = game;
    root._mbDrawDay = drawDay;
    const view = root.dataset.mbView || 'day';
    root.innerHTML = '';
    const toggle = el('div', 'lb-view-toggle');
    [['day', 'today'], ['month', 'month']].forEach(([key, label]) => {
      const b = el('button', 'lb-view-btn' + (view === key ? ' active' : ''), label);
      b.type = 'button';
      b.addEventListener('click', () => {
        if ((root.dataset.mbView || 'day') === key) return;
        root.dataset.mbView = key;
        mount(root, root.dataset.mbGame, root._mbDrawDay);
      });
      toggle.appendChild(b);
    });
    const body = el('div', 'mb-body');
    root.append(toggle, body);
    return view === 'month' ? renderMonth(body) : Promise.resolve(drawDay(body));
  }

  // ── Fanfare ───────────────────────────────────────────────────────────
  function seenKey(game) {
    return 'month_champ_seen_' + game;
  }

  async function announce(game) {
    const champ = await champion(game);
    if (!champ) return;
    try {
      if (localStorage.getItem(seenKey(game)) === String(champ.month)) return;
      localStorage.setItem(seenKey(game), String(champ.month));
    } catch {
      return; // no storage: skip rather than show it on every visit
    }
    const [names, me] = await Promise.all([usernames([champ.user_id]), myUserId()]);
    const overlay = el('div', 'arcade-overlay mb-overlay');
    const card = el('div', 'arcade-card mb-card');
    const confetti = el('div', 'mb-confetti');
    const colors = ['#d4b94a', '#6aaf63', '#6ec6ff', '#f0675d', '#e5e0d8'];
    for (let i = 0; i < 36; i++) {
      const p = el('i');
      p.style.left = Math.random() * 100 + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 1.2).toFixed(2) + 's';
      p.style.animationDuration = (1.8 + Math.random() * 1.4).toFixed(2) + 's';
      confetti.appendChild(p);
    }
    const who = el('div', 'mb-card-name');
    who.appendChild(nameNode(champ.name, champ.user_id, names));
    const mine = me && me === champ.user_id;
    const ok = el('button', 'arcade-btn arcade-btn-primary', mine ? 'long may i reign' : 'all hail');
    ok.type = 'button';
    const close = () => overlay.remove();
    ok.addEventListener('click', close);
    overlay.addEventListener('click', (e) => e.target === overlay && close());
    const btns = el('div', 'arcade-btns');
    btns.appendChild(ok);
    card.append(
      confetti,
      el('div', 'arcade-heading', 'new champion'),
      el('div', 'mb-card-crown', '👑'),
      el('div', 'arcade-inscribe-text', `${monthName(champ.month)}'s ${GAME_NAMES[game] || ''} champion is`),
      who,
      el('div', 'mb-card-stats', `${champ.points} pts · ${champ.wins} win${champ.wins === 1 ? '' : 's'} · ${champ.days_played} day${champ.days_played === 1 ? '' : 's'}`),
      el('div', 'arcade-inscribe-text', mine ? "that's you! the crown is yours all month." : 'the standings have reset. the throne is up for grabs.'),
      btns
    );
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  return { mount, championId, crown, announce };
})();
