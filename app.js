'use strict';
/* Hit-Duell – Partyspiel. Alles läuft lokal im Browser, Spielstand in localStorage. */

const COLORS = ['#ff3d7f', '#ffd43b', '#3ddbd9', '#9775fa', '#51cf66', '#ff922b', '#4dabf7', '#f06595', '#94d82d', '#e599f7'];
const TIMERS = [[30, '30 s'], [60, '1 Min'], [120, '2 Min']];
const ROUNDS = [10, 15, 20];
const MIN_P = 3, MAX_P = 10;

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

let settings = Object.assign({ players: ['', '', ''], rounds: 10, timer: 60, jf: true, adult: false }, store.get('hd-settings', {}));
let custom = store.get('hd-custom', []); // [{id, t, a}]
let G = store.get('hd-game', null);
let view = 'home';
let sel = null;      // aktuelle (geheime) Auswahl beim Punktevergeben – wird nicht gespeichert
let raf = 0;
let lastKey = '';
let backTo = 'home'; // wohin „←“ in „Eigene Kategorien“ führt

const saveSettings = () => store.set('hd-settings', settings);
const saveCustom = () => store.set('hd-custom', custom);
const saveGame = () => (G ? store.set('hd-game', G) : store.del('hd-game'));

/* ---------- Kategorien ---------- */
function poolKeys(jf, adult) {
  const ks = [];
  if (jf) KAT_JF.forEach((_, i) => ks.push('j:' + i));
  if (adult) KAT_18.forEach((_, i) => ks.push('a:' + i));
  custom.forEach((c) => { if (c.a ? adult : jf) ks.push('c:' + c.id); });
  return ks;
}
function catByKey(k) {
  const [t, i] = [k.slice(0, 1), k.slice(2)];
  if (t === 'j') return { t: KAT_JF[i], a: false };
  if (t === 'a') return { t: KAT_18[i], a: true };
  const c = custom.find((x) => x.id === i);
  return c ? { t: c.t, a: c.a, own: true } : null;
}
function drawCat() {
  let ks = poolKeys(G.jf, G.adult).filter((k) => !G.used.includes(k));
  if (!ks.length) {
    G.used = [];
    ks = poolKeys(G.jf, G.adult);
    toast('Alle Kategorien gespielt – es geht von vorn los');
  }
  const k = ks[Math.floor(Math.random() * ks.length)];
  G.used.push(k);
  G.cat = Object.assign({ k }, catByKey(k));
}
const countJF = () => KAT_JF.length + custom.filter((c) => !c.a).length;
const countAdult = () => KAT_18.length + custom.filter((c) => c.a).length;

/* ---------- Helfer ---------- */
const fmtDur = (s) => (s < 60 ? s + ' Sekunden' : s === 60 ? '1 Minute' : s / 60 + ' Minuten');
const fmtClock = (s) => { s = Math.ceil(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const ranksOf = (vals) => vals.map((v) => 1 + vals.filter((x) => x > v).length);
const pName = (i) => esc(G.players[i].name);
const joinNames = (ids) => {
  const n = ids.map((i) => '<b>' + pName(i) + '</b>');
  return n.length < 2 ? n.join('') : n.slice(0, -1).join(', ') + ' & ' + n[n.length - 1];
};
const needBoth = () => G.players.length >= 5;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;

function catCard(small) {
  const c = G.cat;
  return `<div class="cat${small ? ' small-cat' : ''}">${!small && c.a ? '<span class="tag">18+</span>' : ''}${!small && c.own ? '<span class="tag own">★ eigene</span>' : ''}${esc(c.t)}</div>`;
}
function topBar() {
  const t = G.final ? `Finale${G.final.n > 1 ? ' ' + G.final.n : ''}` : `Runde ${G.round} / ${G.rounds}`;
  return `<div class="top">
    <button class="btn icon ghost" data-act="menu" aria-label="Menü">✕</button>
    <div class="title center">${t}</div>
    <button class="btn icon ghost" data-act="standings" aria-label="Punktestand">🏆</button>
  </div>`;
}
function boardHTML(order, opts = {}) {
  const sc = G.players.map((p) => p.score);
  const rk = ranksOf(sc);
  return `<div class="board">${order.map((i, n) => {
    const plus = opts.pts ? opts.pts[i] : null;
    let mv = '';
    if (opts.prev) {
      const d = opts.prev[i] - rk[i];
      mv = d > 0 ? '<span class="mv up">▲</span>' : d < 0 ? '<span class="mv down">▼</span>' : '<span class="mv"></span>';
    }
    return `<div class="brow${rk[i] === 1 ? ' lead' : ''}" style="animation-delay:${n * 60}ms">
      <span class="rank">${rk[i] === 1 ? '👑' : rk[i] + '.'}</span>
      <span class="name">${pName(i)}</span>
      ${plus !== null ? `<span class="plus${opts.hot && opts.hot.includes(i) ? ' hot' : ''}">+${plus}</span>` : ''}
      ${mv}<span class="score">${sc[i]}</span>
    </div>`;
  }).join('')}</div>`;
}
const byScore = () => G.players.map((_, i) => i).sort((a, b) => G.players[b].score - G.players[a].score || a - b);

/* ---------- Ansichten außerhalb des Spiels ---------- */
const VIEWS = {
  home() {
    const resume = G && G.phase !== 'end';
    return `<div class="logo"><div class="mark">🎧</div><h1>Hit-Duell</h1><p>Wer spielt den besten Song?</p></div>
    <div class="bottom">
      ${resume ? `<button class="btn primary big block" data-act="resume">▶ Weiterspielen <span class="small">(${G.final ? 'Finale' : 'Runde ' + G.round + '/' + G.rounds})</span></button>` : ''}
      <button class="btn ${resume ? '' : 'primary'} big block" data-act="go" data-v="setup">Neues Spiel</button>
      <div class="row"><button class="btn" data-act="go" data-v="custom">✏️ Eigene</button><button class="btn" data-act="go" data-v="rules">📖 Regeln</button></div>
      ${isIOS && !standalone ? '<div class="hint">Tipp: In Safari auf <b>Teilen</b> ⬆︎ → <b>Zum Home-Bildschirm</b> – dann läuft Hit-Duell wie eine App im Vollbild, auch offline.</div>' : ''}
      <p class="center muted small">${countJF() + countAdult()} Kategorien · ${custom.length} eigene</p>
    </div>`;
  },

  setup() {
    const ps = settings.players;
    return `<div class="top"><button class="btn icon ghost" data-act="go" data-v="home" aria-label="Zurück">←</button><div class="title">Neues Spiel</div></div>
    <div class="panel">
      <h3>Spieler (${MIN_P}–${MAX_P})</h3>
      <div class="players">${ps.map((n, i) => `<div class="player">
        <span class="num" style="background:${COLORS[i % COLORS.length]}">${i + 1}</span>
        <input class="field" data-pi="${i}" value="${esc(n)}" placeholder="Name ${i + 1}" maxlength="18" autocomplete="off" autocapitalize="words" enterkeyhint="next">
        ${ps.length > MIN_P ? `<button class="btn icon ghost" data-act="delPlayer" data-i="${i}" aria-label="Entfernen">✕</button>` : ''}
      </div>`).join('')}</div>
      ${ps.length < MAX_P ? '<button class="btn ghost" data-act="addPlayer">＋ Spieler</button>' : ''}
    </div>
    <div class="panel">
      <h3>Runden</h3>
      <div class="seg">${ROUNDS.map((r) => `<button class="${settings.rounds === r ? 'on' : ''}" data-act="set" data-k="rounds" data-v="${r}">${r}</button>`).join('')}</div>
      <h3>Zeit zum Suchen</h3>
      <div class="seg">${TIMERS.map(([s, l]) => `<button class="${settings.timer === s ? 'on' : ''}" data-act="set" data-k="timer" data-v="${s}">${l}</button>`).join('')}</div>
    </div>
    <div class="panel">
      <h3>Kategorien</h3>
      <div class="toggles">
        <button class="tgl${settings.jf ? ' on' : ''}" data-act="tgl" data-k="jf"><span class="box">${settings.jf ? '✓' : ''}</span><span><b>Jugendfrei</b><span class="small">${countJF()} Kategorien</span></span></button>
        <button class="tgl${settings.adult ? ' on' : ''}" data-act="tgl" data-k="adult"><span class="box">${settings.adult ? '✓' : ''}</span><span><b>Nicht jugendfrei</b><span class="small">${countAdult()} Kategorien · 18+</span></span></button>
      </div>
      <button class="btn ghost" data-act="go" data-v="custom">✏️ Eigene Kategorien (${custom.length})</button>
    </div>
    <p class="warn center" id="setupWarn"></p>
    <button class="btn primary big block" id="startBtn" data-act="start">Los geht's 🎶</button>`;
  },

  custom() {
    const list = custom.slice().reverse();
    return `<div class="top"><button class="btn icon ghost" data-act="back" aria-label="Zurück">←</button><div class="title">Eigene Kategorien</div></div>
    <div class="panel">
      <textarea class="field" id="newCat" placeholder="z. B. Song, den dein Chef heimlich auf dem Klo hört&#10;(mehrere: eine pro Zeile)" maxlength="2000"></textarea>
      <label class="chk"><input type="checkbox" id="new18"> Nicht jugendfrei (18+)</label>
      <button class="btn primary" data-act="addCat">Hinzufügen</button>
    </div>
    ${list.length ? `<h3>${list.length} eigene Kategorie${list.length > 1 ? 'n' : ''}</h3>
    <div class="clist">${list.map((c) => `<div class="citem"><p>${esc(c.t)}${c.a ? '<span class="badge18">18+</span>' : ''}</p><button class="btn icon ghost" data-act="delCat" data-id="${c.id}" aria-label="Löschen">🗑</button></div>`).join('')}</div>`
    : '<p class="muted center">Noch keine eigenen Kategorien. Sie werden im Spiel zufällig zwischen die anderen gemischt (mit ★ markiert).</p>'}`;
  },

  rules() {
    return `<div class="top"><button class="btn icon ghost" data-act="go" data-v="home" aria-label="Zurück">←</button><div class="title">Spielregeln</div></div>
    <div class="panel rules"><ol>
      <li>Jede Runde zieht die App eine <b>Kategorie</b>. Gefällt sie euch nicht: <b>↻ Andere Kategorie</b>.</li>
      <li>Timer starten – alle suchen <b>heimlich</b> auf ihrem Handy einen passenden Song.</li>
      <li>Zeit um: Reihum spielt jeder seinen Song vor (die App sagt, wer anfängt).</li>
      <li>Das Gerät wird herumgegeben. Jeder vergibt <b>geheim 2 Punkte und 1 Punkt</b> an zwei andere Spieler – nie an sich selbst. Bei 3–4 Spielern reicht auch ein Punkt.</li>
      <li>Danach zeigt die App die Punkte der Runde und den Gesamtstand.</li>
      <li>Nach 10, 15 oder 20 Runden gewinnt, wer die meisten Punkte hat.</li>
      <li><b>Gleichstand?</b> Finale: neue Kategorie, nur die Punktgleichen suchen einen Song. Alle anderen sind die Jury und haben je eine Stimme.</li>
    </ol></div>
    <p class="muted center small">Tipp: Lautlos-Schalter aus, damit ihr das Timer-Signal hört.</p>`;
  },
};

/* ---------- Spielansichten ---------- */
const PHASES = {
  cat() {
    const who = G.final ? `<p class="center muted">Nur ${joinNames(G.final.ids)} suchen einen Song – ${fmtDur(G.timer)} Zeit.</p>`
      : `<p class="center muted">Alle suchen einen passenden Song – ${fmtDur(G.timer)} Zeit.</p>`;
    return `${topBar()}
    <div class="round-no">${G.final ? '⚔️ Entscheidung' : 'Kategorie'}</div>
    ${catCard()}
    ${who}
    <div class="bottom">
      <button class="btn primary big block" data-act="startTimer">⏱ Timer starten</button>
      <button class="btn ghost block" data-act="skip">↻ Andere Kategorie</button>
    </div>`;
  },

  timer() {
    return `${topBar()}
    ${catCard(true)}
    <div class="ring-wrap${G.left != null ? ' paused' : ''}" id="ring">
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <defs><linearGradient id="grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd43b"/><stop offset=".5" stop-color="#ff3d7f"/><stop offset="1" stop-color="#3ddbd9"/></linearGradient></defs>
        <circle class="ring-bg" cx="100" cy="100" r="88"/>
        <circle class="ring-fg" id="ringFg" cx="100" cy="100" r="88" stroke-dasharray="552.92" stroke-dashoffset="0"/>
      </svg>
      <div class="time" id="time" role="timer"></div>
    </div>
    <div class="bottom row">
      <button class="btn" data-act="pause">${G.left != null ? '▶ Weiter' : '⏸ Pause'}</button>
      <button class="btn" data-act="timeUp">Alle fertig ✓</button>
    </div>`;
  },

  play() {
    const ids = G.final ? G.final.ids : G.players.map((_, i) => i);
    const start = (G.round - 1 + (G.final ? G.final.n : 0)) % ids.length;
    const order = ids.slice(start).concat(ids.slice(0, start));
    return `${topBar()}
    <div class="big-msg">
      <div class="emoji">⏰</div>
      <h1>Zeit ist um!</h1>
      <p class="muted">Jetzt spielt ${G.final ? 'jeder Finalist' : 'jeder'} seinen Song vor – in dieser Reihenfolge:</p>
      <div class="order">${order.map((i, n) => `<span class="chip${n === 0 ? ' first' : ''}">${n + 1}. ${pName(i)}</span>`).join('')}</div>
    </div>
    ${catCard(true)}
    <div class="bottom"><button class="btn primary big block" data-act="toVote">${G.final ? 'Zur Jury-Abstimmung →' : 'Zur Punktevergabe →'}</button></div>`;
  },

  pass() {
    const v = G.voters[G.vi];
    const dots = G.voters.map((_, n) => `<i class="${n < G.vi ? 'done' : n === G.vi ? 'cur' : ''}"></i>`).join('');
    return `${topBar()}
    <div class="pass">
      <p class="muted">${G.vi === 0 ? (G.final ? 'Geheime Jury-Abstimmung' : 'Geheime Punktevergabe') : 'Danke! Jetzt weitergeben an'}</p>
      <div class="who">📱 ${pName(v)}</div>
      <p class="muted">Nur ${pName(v)} schaut jetzt aufs Display.</p>
      <div class="dots">${dots}</div>
      <button class="btn primary big" data-act="iam">Ich bin ${pName(v)} →</button>
    </div>`;
  },

  vote() {
    const v = G.voters[G.vi];
    if (G.final) {
      const opts = G.final.ids.filter((i) => i !== v);
      return `${topBar()}
      <h2 class="center">${pName(v)}, wer hatte den besten Song?</h2>
      ${catCard(true)}
      <div class="vote-list">${opts.map((i) => `<div class="vote-row${sel.pick === i ? ' has2' : ''}">
        <span class="name">${pName(i)}</span>
        <button class="pt pick${sel.pick === i ? ' on' : ''}" data-act="pick" data-p="${i}">${sel.pick === i ? '✓ Gewählt' : 'Wählen'}</button></div>`).join('')}</div>
      <div class="bottom"><button class="btn primary big block" data-act="confirmVote" ${sel.pick == null ? 'disabled' : ''}>Stimme abgeben ✓</button></div>`;
    }
    const others = G.players.map((_, i) => i).filter((i) => i !== v);
    const ok = needBoth() ? sel[2] != null && sel[1] != null : sel[2] != null || sel[1] != null;
    const hint = needBoth() ? 'Vergib <b>beide</b>: 2 Punkte und 1 Punkt an zwei verschiedene Spieler.'
      : 'Vergib 2 Punkte und 1 Punkt – mindestens einen davon.';
    return `${topBar()}
    <h2 class="center">${pName(v)}, vergib deine Punkte</h2>
    ${catCard(true)}
    <div class="vote-status">
      <span class="${sel[2] != null ? 'ok2' : ''}">2 Punkte: ${sel[2] != null ? pName(sel[2]) : '–'}</span>
      <span class="${sel[1] != null ? 'ok1' : ''}">1 Punkt: ${sel[1] != null ? pName(sel[1]) : '–'}</span>
    </div>
    <div class="vote-list">${others.map((i) => `<div class="vote-row${sel[2] === i ? ' has2' : sel[1] === i ? ' has1' : ''}">
      <span class="name">${pName(i)}</span>
      <button class="pt${sel[2] === i ? ' on2' : ''}" data-act="give" data-p="${i}" data-v="2" aria-label="2 Punkte für ${pName(i)}">2</button>
      <button class="pt${sel[1] === i ? ' on1' : ''}" data-act="give" data-p="${i}" data-v="1" aria-label="1 Punkt für ${pName(i)}">1</button>
    </div>`).join('')}</div>
    <p class="muted small center">${hint}</p>
    <div class="bottom"><button class="btn primary big block" data-act="confirmVote" ${ok ? '' : 'disabled'}>Punkte abgeben ✓</button></div>`;
  },

  reveal() {
    const pts = G.roundPts;
    const max = Math.max(...pts);
    const hot = max > 0 ? pts.map((p, i) => (p === max ? i : -1)).filter((i) => i >= 0) : [];
    const line = max > 0 ? `🔥 Bester Song: ${joinNames(hot)} <span class="muted">(+${max})</span>` : 'Diese Runde gab es keine Punkte.';
    return `${topBar()}
    <h2 class="center">Runde ${G.round} – Ergebnis</h2>
    ${catCard(true)}
    <p class="winner-line">${line}</p>
    ${boardHTML(byScore(), { pts, hot, prev: G.prevRank })}
    <div class="bottom">${G.round < G.rounds
      ? `<button class="btn primary big block" data-act="nextRound">Runde ${G.round + 1} →</button>`
      : '<button class="btn yellow big block" data-act="finish">🏁 Zum Endstand</button>'}</div>`;
  },

  finalIntro() {
    const f = G.final;
    const score = G.players[f.ids[0]].score;
    const jury = f.allJudge
      ? '<p class="muted">Alle sind punktgleich – jeder stimmt für einen <b>anderen</b> Spieler.</p>'
      : `<p class="muted">Jury: ${joinNames(f.judges)} – jeder hat <b>eine</b> Stimme.</p>`;
    return `${topBar()}
    <div class="big-msg">
      <div class="emoji">⚔️</div>
      <h1>${f.n > 1 ? 'Immer noch Gleichstand!' : 'Gleichstand!'}</h1>
      <p>${joinNames(f.ids)} ${f.n > 1 ? 'liegen wieder gleichauf' : `haben je ${score} Punkte`}.</p>
      <p class="muted">Ein Finale entscheidet: neue Kategorie, nur die Finalisten suchen einen Song.</p>
      ${jury}
    </div>
    <div class="bottom"><button class="btn yellow big block" data-act="startFinal">Finale starten ⚔️</button></div>`;
  },

  finalResult() {
    const f = G.final;
    const max = Math.max(...f.ids.map((i) => f.votes[i]));
    const top = f.ids.filter((i) => f.votes[i] === max);
    const rows = f.ids.slice().sort((a, b) => f.votes[b] - f.votes[a]).map((i, n) => `<div class="brow${f.votes[i] === max ? ' lead' : ''}" style="animation-delay:${n * 80}ms">
      <span class="rank">${f.votes[i] === max ? '👑' : ''}</span><span class="name">${pName(i)}</span>
      <span class="score">${f.votes[i]} <span class="small muted">Stimme${f.votes[i] === 1 ? '' : 'n'}</span></span></div>`).join('');
    if (top.length === 1) {
      return `${topBar()}
      <div class="big-msg"><div class="emoji">👑</div><h1>${pName(top[0])} gewinnt das Finale!</h1></div>
      <div class="board">${rows}</div>
      <div class="bottom"><button class="btn yellow big block" data-act="champion" data-p="${top[0]}">🏁 Zum Endstand</button></div>`;
    }
    return `${topBar()}
    <div class="big-msg"><div class="emoji">😱</div><h1>Wieder Gleichstand!</h1><p>${joinNames(top)} haben gleich viele Stimmen.</p></div>
    <div class="board">${rows}</div>
    <div class="bottom">
      <button class="btn yellow big block" data-act="againFinal">⚔️ Noch ein Finale</button>
      <button class="btn ghost block" data-act="shareWin">🤝 Geteilter Sieg</button>
    </div>`;
  },

  end() {
    // Finale-Sieger (bzw. alle Teilhaber eines geteilten Siegs) stehen vor anderen Punktgleichen
    const bonus = (i) => (G.champion === i || (G.shared || []).includes(i) ? 0.5 : 0);
    const order = G.players.map((_, i) => i).sort((a, b) => G.players[b].score + bonus(b) - G.players[a].score - bonus(a) || a - b);
    const vals = G.players.map((p, i) => p.score + bonus(i));
    const rk = ranksOf(vals);
    const pod = order.slice(0, 3);
    const podOrder = pod.length === 3 ? [pod[1], pod[0], pod[2]] : pod;
    const cls = (i) => 'p' + Math.min(rk[i], 3);
    const winners = order.filter((i) => rk[i] === 1);
    const recap = G.log.map((r, n) => {
      const mx = Math.max(...r.pts);
      const w = mx > 0 ? r.pts.map((p, i) => (p === mx ? i : -1)).filter((i) => i >= 0) : [];
      return `<div>${n + 1}. ${esc(r.cat)}<br>${w.length ? '🔥 ' + joinNames(w) + ` (+${mx})` : '<span class="muted">keine Punkte</span>'}</div>`;
    }).join('');
    return `<div class="big-msg"><div class="crown">👑</div>
      <h1>${winners.length > 1 ? 'Geteilter Sieg!' : pName(winners[0]) + ' gewinnt!'}</h1>
      ${winners.length > 1 ? `<p>${joinNames(winners)}</p>` : G.champion != null ? '<p class="muted">… nach einem Finale!</p>' : ''}
    </div>
    <div class="podium">${podOrder.map((i) => `<div class="pod ${cls(i)}"><span class="nm">${pName(i)}</span><div class="blk">${rk[i]}<small>${G.players[i].score} P.</small></div></div>`).join('')}</div>
    ${order.length > 3 ? `<div class="board">${order.slice(3).map((i) => `<div class="brow"><span class="rank">${rk[i]}.</span><span class="name">${pName(i)}</span><span class="score">${G.players[i].score}</span></div>`).join('')}</div>` : ''}
    <div class="bottom">
      <button class="btn primary big block" data-act="again">🔁 Nochmal spielen</button>
      <button class="btn ghost block" data-act="home">Startseite</button>
    </div>
    <h3>Rückblick</h3>
    <div class="recap">${recap}</div>`;
  },
};

/* ---------- Rendern ---------- */
function render() {
  cancelAnimationFrame(raf);
  const inGame = view === 'game' && G;
  const html = inGame ? (PHASES[G.phase] || PHASES.cat)() : VIEWS[view]();
  $('#app').innerHTML = `<section class="screen">${html}</section>`;
  const key = view + '|' + (inGame ? G.phase + G.round + (G.vi || 0) + (G.final ? 'f' + G.final.n : '') : '');
  if (key !== lastKey) { window.scrollTo(0, 0); lastKey = key; }
  keepAwake(!!inGame);
  if (inGame && G.phase === 'timer') tick();
  if (inGame && G.phase === 'end' && !G.confetti) { G.confetti = true; saveGame(); confetti(); }
  if (view === 'setup') validateSetup();
}

/* ---------- Timer ---------- */
const CIRC = 552.92;
let lastBeep = -1;
function timeLeft() { return G.left != null ? G.left : Math.max(0, (G.endAt - Date.now()) / 1000); }
function tick() {
  const left = timeLeft();
  const fg = $('#ringFg'), tm = $('#time'), ring = $('#ring');
  if (!fg) return;
  fg.setAttribute('stroke-dashoffset', String(CIRC * (1 - left / G.timer)));
  tm.textContent = fmtClock(left);
  ring.classList.toggle('hurry', left <= 5 && G.left == null);
  const sec = Math.ceil(left);
  if (G.left == null && sec <= 5 && sec > 0 && sec !== lastBeep) { lastBeep = sec; beep(660, 0.08, 0.18); }
  if (left <= 0) return timeUp(true);
  raf = requestAnimationFrame(tick);
}
function timeUp(sound) {
  cancelAnimationFrame(raf);
  if (sound) { alarm(); try { navigator.vibrate && navigator.vibrate([300, 120, 300]); } catch {} }
  G.phase = 'play'; G.endAt = null; G.left = null;
  saveGame(); render();
}

/* ---------- Ton & Display ---------- */
let actx = null;
function unlockAudio() {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch {}
}
function beep(freq, dur, vol, when = 0) {
  if (!actx) return;
  try {
    const t = actx.currentTime + when;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'triangle'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t); o.stop(t + dur + 0.05);
  } catch {}
}
function alarm() { [0, 0.16, 0.32, 0.62, 0.78, 0.94].forEach((w, i) => beep(i % 3 === 2 ? 1320 : 990, 0.15, 0.4, w)); }

let wl = null;
async function keepAwake(on) {
  try {
    if (on && !wl && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wl = await navigator.wakeLock.request('screen');
      wl.addEventListener('release', () => { wl = null; });
    } else if (!on && wl) { await wl.release(); wl = null; }
  } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(view === 'game' && !!G); });

function confetti() {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:5';
  for (let i = 0; i < 90; i++) {
    const s = document.createElement('i');
    const size = 6 + Math.random() * 8;
    s.style.cssText = `position:absolute;top:-20px;left:${Math.random() * 100}%;width:${size}px;height:${size * 1.6}px;background:${COLORS[i % COLORS.length]};border-radius:2px;opacity:.95`;
    s.animate([{ transform: `translateY(0) rotate(0deg)` }, { transform: `translate(${(Math.random() - 0.5) * 200}px, 110vh) rotate(${Math.random() * 900}deg)` }],
      { duration: 2200 + Math.random() * 1800, delay: Math.random() * 600, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' });
    box.appendChild(s);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 4800);
}

/* ---------- Toast & Dialog ---------- */
let toastT = 0;
function toast(msg, btn, fn) {
  const t = $('#toast');
  t.innerHTML = `<span>${msg}</span>${btn ? `<button>${btn}</button>` : ''}`;
  t.hidden = false;
  if (btn) t.querySelector('button').onclick = () => { t.hidden = true; fn(); };
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, btn ? 5000 : 2500);
}
function dialog(html) {
  const d = $('#dlg');
  d.innerHTML = html;
  if (!d.open) d.showModal();
}
const closeDlg = () => { const d = $('#dlg'); if (d.open) d.close(); };
$('#dlg').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeDlg(); });

/* ---------- Setup-Validierung ---------- */
function setupProblem() {
  const names = settings.players.map((n) => n.trim()).filter(Boolean);
  if (names.length < MIN_P) return `Mindestens ${MIN_P} Spieler eintragen.`;
  const low = names.map((n) => n.toLowerCase());
  const dup = low.find((n, i) => low.indexOf(n) !== i);
  if (dup) return `Der Name „${esc(names[low.indexOf(dup)])}“ kommt doppelt vor.`;
  if (!settings.jf && !settings.adult) return 'Wähle mindestens eine Kategorie-Art.';
  return '';
}
function validateSetup() {
  const p = setupProblem();
  const w = $('#setupWarn'), b = $('#startBtn');
  if (w) w.innerHTML = p;
  if (b) b.disabled = !!p;
}

/* ---------- Spielablauf ---------- */
function newGame() {
  const names = settings.players.map((n) => n.trim()).filter(Boolean);
  G = {
    players: names.map((name) => ({ name, score: 0 })),
    rounds: settings.rounds, timer: settings.timer, jf: settings.jf, adult: settings.adult,
    round: 1, used: [], log: [], phase: 'cat', cat: null,
    voters: [], vi: 0, roundPts: [], prevRank: null,
    final: null, champion: null, shared: null, endAt: null, left: null,
  };
  drawCat();
  saveGame();
  view = 'game';
  render();
}
function startFinal(ids) {
  let judges = G.players.map((_, i) => i).filter((i) => !ids.includes(i));
  const allJudge = judges.length === 0;
  if (allJudge) judges = G.players.map((_, i) => i);
  G.final = { ids, judges, allJudge, votes: G.players.map(() => 0), n: G.final ? G.final.n + 1 : 1 };
  G.phase = 'finalIntro';
}

const ACT = {
  go(d) { if (d.v === 'custom') backTo = view === 'setup' ? 'setup' : 'home'; view = d.v; render(); },
  back() { view = backTo; render(); },
  home() { if (G && G.phase === 'end') { G = null; saveGame(); } view = 'home'; render(); },
  resume() { if (G.phase === 'vote') G.phase = 'pass'; view = 'game'; render(); },

  addPlayer() {
    if (settings.players.length >= MAX_P) return;
    settings.players.push(''); saveSettings(); render();
    const ins = document.querySelectorAll('[data-pi]'); ins[ins.length - 1].focus();
  },
  delPlayer(d) { settings.players.splice(+d.i, 1); saveSettings(); render(); },
  set(d) { settings[d.k] = +d.v; saveSettings(); render(); },
  tgl(d) { settings[d.k] = !settings[d.k]; saveSettings(); render(); },
  start() {
    if (setupProblem()) return;
    if (G && G.phase !== 'end') {
      return dialog(`<div class="stack"><h2>Neues Spiel starten?</h2><p class="muted">Das laufende Spiel wird dabei beendet.</p>
        <button class="btn primary" data-act="startForce">Ja, neues Spiel</button><button class="btn ghost" data-act="closeDlg">Abbrechen</button></div>`);
    }
    newGame();
  },
  startForce() { closeDlg(); newGame(); },

  addCat() {
    const ta = $('#newCat');
    const lines = ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!lines.length) { ta.focus(); return; }
    const a = $('#new18').checked;
    lines.forEach((t, n) => custom.push({ id: Date.now().toString(36) + n, t, a }));
    saveCustom(); render();
    toast(lines.length === 1 ? 'Kategorie hinzugefügt' : `${lines.length} Kategorien hinzugefügt`);
  },
  delCat(d) {
    const i = custom.findIndex((c) => c.id === d.id);
    if (i < 0) return;
    const [c] = custom.splice(i, 1);
    saveCustom(); render();
    toast('Gelöscht', 'Rückgängig', () => { custom.splice(i, 0, c); saveCustom(); render(); });
  },

  menu() {
    dialog(`<div class="stack"><h2>Menü</h2>
      <button class="btn" data-act="pauseHome">⏸ Zur Startseite <span class="small muted">(Spiel bleibt gespeichert)</span></button>
      <button class="btn ghost" data-act="quitAsk">🛑 Spiel beenden</button>
      <button class="btn ghost" data-act="closeDlg">Zurück zum Spiel</button></div>`);
  },
  pauseHome() {
    closeDlg();
    if (G.phase === 'timer' && G.left == null) G.left = timeLeft();
    if (G.phase === 'vote') G.phase = 'pass';
    saveGame(); view = 'home'; render();
  },
  quitAsk() {
    dialog(`<div class="stack"><h2>Spiel wirklich beenden?</h2><p class="muted">Der Spielstand geht verloren.</p>
      <button class="btn primary" data-act="quit">Ja, beenden</button><button class="btn ghost" data-act="closeDlg">Abbrechen</button></div>`);
  },
  quit() { closeDlg(); G = null; saveGame(); view = 'home'; render(); },
  closeDlg,
  standings() {
    dialog(`<div class="stack"><h2>Punktestand</h2>${boardHTML(byScore())}<button class="btn ghost" data-act="closeDlg">Schließen</button></div>`);
  },

  skip() { drawCat(); saveGame(); render(); },
  startTimer() { G.phase = 'timer'; G.endAt = Date.now() + G.timer * 1000; G.left = null; lastBeep = -1; saveGame(); render(); },
  pause() {
    if (G.left != null) { G.endAt = Date.now() + G.left * 1000; G.left = null; }
    else { G.left = timeLeft(); }
    saveGame(); render();
  },
  timeUp() { timeUp(false); },

  toVote() {
    const all = G.final ? G.final.judges : G.players.map((_, i) => i);
    const start = (G.round - 1) % all.length;
    G.voters = all.slice(start).concat(all.slice(0, start));
    G.vi = 0;
    if (!G.final) G.roundPts = G.players.map(() => 0);
    G.phase = 'pass';
    saveGame(); render();
  },
  iam() { sel = { 1: null, 2: null, pick: null }; G.phase = 'vote'; render(); },
  give(d) {
    const p = +d.p, v = +d.v, o = v === 2 ? 1 : 2;
    if (sel[v] === p) sel[v] = null;
    else { sel[v] = p; if (sel[o] === p) sel[o] = null; }
    render();
  },
  pick(d) { sel.pick = +d.p; render(); },
  confirmVote() {
    if (!sel) return;
    if (G.final) {
      if (sel.pick == null) return;
      G.final.votes[sel.pick]++;
    } else {
      const ok = needBoth() ? sel[2] != null && sel[1] != null : sel[2] != null || sel[1] != null;
      if (!ok) return;
      if (sel[2] != null) G.roundPts[sel[2]] += 2;
      if (sel[1] != null) G.roundPts[sel[1]] += 1;
    }
    sel = null;
    G.vi++;
    if (G.vi < G.voters.length) G.phase = 'pass';
    else if (G.final) G.phase = 'finalResult';
    else {
      G.prevRank = ranksOf(G.players.map((p) => p.score));
      G.players.forEach((p, i) => { p.score += G.roundPts[i]; });
      G.log.push({ cat: G.cat.t, pts: G.roundPts.slice() });
      G.phase = 'reveal';
    }
    saveGame(); render();
  },
  nextRound() { G.round++; G.prevRank = null; drawCat(); G.phase = 'cat'; saveGame(); render(); },
  finish() {
    const sc = G.players.map((p) => p.score);
    const max = Math.max(...sc);
    const top = sc.map((s, i) => (s === max ? i : -1)).filter((i) => i >= 0);
    if (top.length === 1) { G.champion = null; G.phase = 'end'; }
    else startFinal(top);
    saveGame(); render();
  },
  startFinal() { drawCat(); G.phase = 'cat'; saveGame(); render(); },
  champion(d) { G.champion = +d.p; G.phase = 'end'; saveGame(); render(); },
  againFinal() {
    const f = G.final;
    const max = Math.max(...f.ids.map((i) => f.votes[i]));
    startFinal(f.ids.filter((i) => f.votes[i] === max));
    saveGame(); render();
  },
  shareWin() {
    const f = G.final;
    const max = Math.max(...f.ids.map((i) => f.votes[i]));
    G.shared = f.ids.filter((i) => f.votes[i] === max);
    G.champion = null; G.phase = 'end'; saveGame(); render();
  },
  again() {
    settings.players = G.players.map((p) => p.name); saveSettings();
    G = null; saveGame(); view = 'setup'; render();
  },
};

/* ---------- Events ---------- */
document.addEventListener('pointerdown', unlockAudio, { passive: true });
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const fn = ACT[b.dataset.act];
  if (fn) fn(b.dataset, b);
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.pi != null) {
    settings.players[+t.dataset.pi] = t.value;
    saveSettings(); validateSetup();
  }
});
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (e.key !== 'Enter' || !t.dataset || t.dataset.pi == null) return;
  e.preventDefault();
  const ins = [...document.querySelectorAll('[data-pi]')];
  const i = ins.indexOf(t);
  if (i < ins.length - 1) ins[i + 1].focus();
  else if (t.value.trim() && settings.players.length < MAX_P) ACT.addPlayer();
  else t.blur();
});

/* ---------- Start ---------- */
if (G && G.phase !== 'end') {
  if (G.phase === 'vote') G.phase = 'pass';
  view = 'game';
}
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadCtrl = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((r) => {
    r.addEventListener('updatefound', () => {
      const w = r.installing;
      w && w.addEventListener('statechange', () => {
        if (w.state === 'activated' && hadCtrl) toast('Neue Version da', 'Neu laden', () => location.reload());
      });
    });
  }).catch(() => {});
}
