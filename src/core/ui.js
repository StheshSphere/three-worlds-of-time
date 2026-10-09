import { settings } from './settings.js';

/**
 * DOM UI controller: screens, HUD, overlays. The 3D game never touches the
 * DOM directly — it calls these methods. HUD text only changes the DOM when
 * the value actually changes (DOM writes every frame cause layout jank).
 */
const $ = (id) => document.getElementById(id);

export class UI {
  constructor(audio) {
    this.audio = audio;
    this.stack = [];               // open panel screens (options/controls/credits…)
    this.onPanelClosed = null;
    this._cache = {};
    this._messageTimer = null;
    this.journal = [];

    // Generic open/close buttons.
    document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => this.openPanel(b.dataset.open)));
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => this.closeTopPanel()));
    document.querySelectorAll('button').forEach((b) => {
      b.addEventListener('mouseenter', () => audio.play('ui-hover', { volume: 0.35 }));
      b.addEventListener('click', () => audio.play('ui-click', { volume: 0.6 }));
    });
    this._bindOptions();
    this._bindKeypad();
  }

  /* ----------------------------- screens ---------------------------- */
  show(id) { $(id).classList.remove('hidden'); }
  hide(id) { $(id).classList.add('hidden'); }
  isOpen(id) { return !$(id).classList.contains('hidden'); }

  openPanel(id) {
    this.openedAt = performance.now();
    this.stack.push(id);
    this.show(id);
    this.audio.play('ui-open', { volume: 0.4 });
  }

  closeTopPanel() {
    const id = this.stack.pop();
    if (!id) return null;
    this.hide(id);
    this.audio.play('ui-close', { volume: 0.4 });
    if (this.onPanelClosed) this.onPanelClosed(id);
    return id;
  }

  closeAllPanels() { while (this.stack.length) this.hide(this.stack.pop()); }
  get panelOpen() { return this.stack.length > 0; }
  /** True just after a panel opened — stops the opening keypress from also closing it. */
  get justOpened() { return performance.now() - (this.openedAt || 0) < 300; }

  /* ----------------------------- loading ---------------------------- */
  // The bar is byte-weighted real progress (see assets.js): it only moves
  // when bytes actually arrive or a job actually finishes. Name the job that
  // is loading instead of printing a percentage on top of it.
  setProgress(f, label) {
    $('progress-fill').style.width = `${Math.round(f * 100)}%`;
    if (label) {
      const pretty = label
        .replace(/^audio music:/, 'music: ')
        .replace(/^audio /, 'sound: ')
        .replace(/^texture /, 'texture: ')
        .replace(/^model /, 'model: ');
      $('loading-text').textContent = `Gathering fragments of time… ${pretty}`;
    }
  }

  /** Post-load boot phase (hero rig, machines, title backdrop) — say what is
   *  actually happening rather than freezing on the finished bar. */
  setLoadingText(text) { $('loading-text').textContent = text; }

  /* ----------------------------- HUD -------------------------------- */
  _set(id, prop, value) {
    const key = id + prop;
    if (this._cache[key] === value) return;
    this._cache[key] = value;
    const el = $(id);
    if (prop === 'text') el.textContent = value;
    else if (prop === 'width') el.style.width = value;
    else if (prop === 'hidden') el.classList.toggle('hidden', value);
  }

  setEra(index, name) {
    document.body.dataset.era = String(index);
    this._set('era-badge', 'text', name);
  }

  setObjective(text) { this._set('objective', 'text', text || ''); }

  /** items: [{ text, state: 'done' | 'active' | 'todo' }] — only touches the DOM when it changes. */
  setChecklist(items) {
    const key = items ? items.map((i) => i.state[0] + i.text).join('|') : '';
    if (this._cache.checklist === key) return;
    this._cache.checklist = key;
    const ul = $('checklist');
    ul.innerHTML = '';
    for (const it of items || []) {
      const li = document.createElement('li');
      li.className = it.state;
      li.textContent = it.text;
      ul.appendChild(li);
    }
  }

  /** Instruction card: { kicker, title, html } — stays up `seconds`, H brings back the last one. */
  tutorial(card, seconds = 12) {
    this._tutorial = card;
    $('tut-kicker').textContent = card.kicker || 'How to play';
    $('tut-title').textContent = card.title;
    $('tut-body').innerHTML = card.html;
    const el = $('tutorial-card');
    el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(this._tutTimer);
    this._tutTimer = setTimeout(() => el.classList.add('hidden'), seconds * 1000);
    this.audio.play('ui-open', { volume: 0.5 });
  }

  toggleTutorial() {
    const el = $('tutorial-card');
    if (!el.classList.contains('hidden')) { el.classList.add('hidden'); return; }
    if (this._tutorial) this.tutorial(this._tutorial, 15);
  }

  hideTutorial() { $('tutorial-card').classList.add('hidden'); this._tutorial = null; }

  /** Screen-space waypoint. edgeAngle (radians) set → pinned to the screen edge, arrow pointing out. */
  setWaypoint(visible, x = 0, y = 0, dist = 0, edgeAngle = null) {
    const el = $('waypoint');
    if (!visible) { if (!this._cache.wpHidden) { el.classList.add('hidden'); this._cache.wpHidden = true; } return; }
    if (this._cache.wpHidden !== false) { el.classList.remove('hidden'); this._cache.wpHidden = false; }
    el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    el.classList.toggle('edge', edgeAngle !== null);
    if (edgeAngle !== null) el.querySelector('.wp-arrow').style.transform = `rotate(${edgeAngle}rad)`;
    this._set('wp-dist', 'text', `${Math.round(dist)} m`);
  }
  setHint(text) { this._set('hint', 'text', text || ''); }

  setStability(frac, secondsLeft) {
    this._set('stability-fill', 'width', `${Math.max(0, frac * 100).toFixed(1)}%`);
    const low = frac < 0.2;
    if (this._cache.low !== low) { this._cache.low = low; $('stability-fill').classList.toggle('low', low); }
    const s = Math.max(0, Math.ceil(secondsLeft));
    this._set('stability-time', 'text', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  }

  setCores(n) {
    document.querySelectorAll('.core-slot').forEach((el, i) => el.classList.toggle('lit', i < n));
  }

  setPrompt(text) {
    this._set('interact-prompt', 'hidden', !text);
    if (text) this._set('interact-label', 'text', text);
    const active = !!text;
    if (this._cache.cross !== active) { this._cache.cross = active; $('crosshair').classList.toggle('active', active); }
  }

  setCrosshairVisible(v) { this._set('crosshair', 'hidden', !v); }

  message(text, ms = 3200) {
    const el = $('message-banner');
    el.textContent = text;
    el.classList.add('active');
    clearTimeout(this._messageTimer);
    this._messageTimer = setTimeout(() => el.classList.remove('active'), ms);
  }

  clearMessage() { $('message-banner').classList.remove('active'); }

  setDash(visible, ready) {
    this._set('dash-meter', 'hidden', !visible);
    if (visible) $('dash-meter').querySelector('.dash-fill').style.transform = `scaleX(${Math.max(0.02, ready).toFixed(2)})`;
  }

  setFps(v) {
    const show = settings.get('showFps');
    this._set('fps', 'hidden', !show);
    if (show) this._set('fps', 'text', `${v} fps`);
  }

  setMinimapVisible(v) { this._set('minimap-frame', 'hidden', !v); }

  damage() {
    const el = $('damage-flash');
    el.classList.add('active');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('active')));
  }

  fade(on, color = 'white') {
    const el = $('fade-layer');
    el.classList.toggle('black', color === 'black');
    el.classList.toggle('active', on);
  }

  /**
   * Era transition card: { numeral, title, sub, tag, verb, line } — the era
   * word of play (e.g. "The Past — Solve") and one line of story, tinted by
   * the era accent. Pure DOM + CSS animations and pointer-events:none, so it
   * can never disturb pointer lock, the loading screen or the render loop.
   */
  eraCard(card) {
    const el = $('era-card');
    $('era-card-numeral').textContent = card.numeral;
    $('era-card-title').textContent = card.title;
    $('era-card-sub').textContent = card.sub;
    $('era-card-tag').textContent = card.verb ? `${card.tag || ''} — ${card.verb}` : (card.tag || '');
    $('era-card-line').textContent = card.line || '';
    el.classList.add('hidden');
    void el.offsetWidth; // restart CSS animations
    el.classList.remove('hidden');
    clearTimeout(this._eraTimer);
    this._eraTimer = setTimeout(() => el.classList.add('hidden'), 4700);
  }

  /* ----------------------------- journal ---------------------------- */
  resetJournal() { this.journal = []; this._renderJournal(); }

  addJournal(html, key) {
    if (key && this.journal.some((j) => j.key === key)) return;
    this.journal.push({ html, key });
    this._renderJournal();
    this.audio.play('page', { volume: 0.7 });
  }

  _renderJournal() {
    const list = $('journal-list');
    list.innerHTML = '';
    if (!this.journal.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No clues yet. Explore, read and examine everything.';
      list.appendChild(li);
      return;
    }
    for (const j of this.journal) {
      const li = document.createElement('li');
      li.innerHTML = j.html;
      list.appendChild(li);
    }
  }

  /* ----------------------------- reader (notes, terminals) ---------- */
  openReader({ kicker = '', title = '', body = '', html = null }) {
    $('reader-kicker').textContent = kicker;
    $('reader-title').textContent = title;
    const b = $('reader-body');
    if (html) b.innerHTML = html; else b.textContent = body;
    this.openPanel('reader-screen');
  }

  /* ----------------------------- keypad ----------------------------- */
  _bindKeypad() {
    this._keypadValue = '';
    this.onKeypadSubmit = null;
    const press = (k) => {
      if (!this.isOpen('keypad-screen')) return;
      const disp = $('keypad-display');
      disp.classList.remove('error', 'ok');
      if (k === 'clear') this._keypadValue = '';
      else if (k === 'enter') {
        const ok = this.onKeypadSubmit ? this.onKeypadSubmit(this._keypadValue) : false;
        disp.classList.add(ok ? 'ok' : 'error');
        this.audio.play(ok ? 'ui-confirm' : 'ui-error');
        if (!ok) this._keypadValue = '';
        else setTimeout(() => { if (this.isOpen('keypad-screen')) this.closeTopPanel(); }, 700);
      } else if (this._keypadValue.length < 4) this._keypadValue += k;
      this.audio.play('keypad', { volume: 0.6 });
      disp.textContent = (this._keypadValue + '____').slice(0, 4);
    };
    document.querySelectorAll('#keypad-screen [data-key]').forEach((b) => b.addEventListener('click', () => press(b.dataset.key)));
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen('keypad-screen')) return;
      if (/^Digit\d$|^Numpad\d$/.test(e.code)) press(e.code.slice(-1));
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') press('enter');
      else if (e.code === 'Backspace') press('clear');
    });
  }

  openKeypad(onSubmit) {
    this._keypadValue = '';
    $('keypad-display').textContent = '____';
    $('keypad-display').classList.remove('error', 'ok');
    this.onKeypadSubmit = onSubmit;
    this.openPanel('keypad-screen');
  }

  /* ----------------------------- options ---------------------------- */
  _bindOptions() {
    document.querySelectorAll('[data-setting]').forEach((input) => {
      const key = input.dataset.setting;
      const v = settings.get(key);
      if (input.type === 'checkbox') input.checked = !!v; else input.value = v;
      input.addEventListener('input', () => {
        const val = input.type === 'checkbox' ? input.checked : (input.type === 'range' ? Number(input.value) : input.value);
        settings.set(key, val);
      });
    });
  }

  /* ----------------------------- end screens ------------------------ */
  showFail(reason) {
    $('fail-reason').textContent = reason;
    this.show('fail-screen');
  }

  showWin(stats) {
    const dl = $('win-stats');
    dl.innerHTML = '';
    for (const [k, v] of stats) {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      dl.append(dt, dd);
    }
    this.show('win-screen');
  }

  setBestTime(text) { $('best-time').textContent = text || ''; }

  /* ----------------------------- cinematics ------------------------- */
  cinema(on, letterbox = true) {
    $('cinema').classList.toggle('hidden', !on);
    $('cinema').classList.toggle('no-bars', !letterbox);
  }

  /** Typed-out caption. speaker null/'' → narrator style. Pass speaker=null and text=null to hide. */
  caption(speaker, text, seconds = 4.5, { inGame = false } = {}) {
    const box = $('caption');
    clearInterval(this._typeTimer);
    clearTimeout(this._capTimer);
    if (!text) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.classList.toggle('in-game', inGame);
    box.classList.toggle('narrator', !speaker);
    $('caption-speaker').textContent = speaker || '';
    const el = $('caption-text');
    el.textContent = '';
    box.style.animation = 'none'; void box.offsetWidth; box.style.animation = '';
    let i = 0;
    this._typeTimer = setInterval(() => {
      i += 2;
      el.textContent = text.slice(0, i);
      if (i >= text.length) clearInterval(this._typeTimer);
    }, 18);
    this._capTimer = setTimeout(() => box.classList.add('hidden'), seconds * 1000);
  }

  /** In-game dialogue (no letterbox): a queue of [speaker, text, seconds] lines. */
  say(lines) {
    clearTimeout(this._sayTimer);
    const next = (k) => {
      if (k >= lines.length) return;
      const [sp, tx, sec = 4.5] = lines[k];
      this.caption(sp, tx, sec, { inGame: true });
      this._sayTimer = setTimeout(() => next(k + 1), sec * 1000 + 250);
    };
    next(0);
  }

  stopSay() { clearTimeout(this._sayTimer); this.caption(null, null); }

  endCard(on) { $('end-card').classList.toggle('hidden', !on); }

  rollCredits(on) {
    const roll = $('credits-roll');
    if (!on) { roll.classList.add('hidden'); roll.classList.remove('rolling'); return; }
    const inner = roll.querySelector('.roll-inner');
    inner.innerHTML = '<h2>The Three Worlds of Time</h2><p>The Broken Hourglass</p>'
      + '<h2>A Wits CGV group project</h2><p>COMS3006A · COMS3025A</p>'
      + '<h2>Built with</h2>' + document.getElementById('credits-list').outerHTML.replace('id="credits-list"', '')
      + '<h2>Thank you for playing</h2>';
    roll.classList.remove('hidden', 'rolling');
    void roll.offsetWidth;
    roll.classList.add('rolling');
  }
  setPauseLevel(text) { $('pause-level').textContent = text; }
}
