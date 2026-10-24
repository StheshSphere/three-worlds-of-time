import { settings } from './settings.js';
import { Dialogue } from './dialogue.js';
import { Voice } from './voice.js';
import { rankFor, LEVEL_TITLES, OVERALL_TITLES, PAR_TIMES } from './stats.js';
import { journalTablets } from '../levels/tabletPuzzle.js';

/**
 * DOM UI controller: screens, HUD, overlays. The 3D game never touches the
 * DOM directly — it calls these methods. HUD text only changes the DOM when
 * the value actually changes (DOM writes every frame cause layout jank).
 */
const $ = (id) => document.getElementById(id);

export class UI {
  constructor(audio, { dialogueClock } = {}) {
    this.audio = audio;
    this.stack = [];               // open panel screens (options/controls/credits…)
    this.onPanelClosed = null;
    this.onPanelOpened = null;
    this._cache = {};
    this._messageTimer = null;
    this.journal = [];
    this.dialogue = new Dialogue({ render: entry => this._renderDialogue(entry), clock: dialogueClock });
    this.dialogue.voice = new Voice(audio);

    // Generic open/close buttons.
    document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => this.openPanel(b.dataset.open)));
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => this.closeTopPanel()));
    document.querySelectorAll('button').forEach((b) => {
      b.addEventListener('mouseenter', () => audio.play('ui-hover', { volume: 0.35 }));
      b.addEventListener('click', () => audio.play('ui-click', { volume: 0.6 }));
    });
    this._bindOptions();
    this._bindKeypad();
    this._bindPowerGrid();
    this._bindJourneyStats();
    this._distanceMapEnabled = false;
    this._bindDistanceHint();
  }

  /* ----------------------------- screens ---------------------------- */
  show(id) { $(id).classList.remove('hidden'); }
  hide(id) { $(id).classList.add('hidden'); }
  isOpen(id) { return !$(id).classList.contains('hidden'); }

  openPanel(id) {
    if (this.stack.includes(id)) return;
    this.openedAt = performance.now();
    this._panelFocus = document.activeElement;
    this.stack.push(id);
    this.dialogue.setPaused('panel', true);
    this.show(id);
    $(id).querySelector('button, input, select')?.focus({ preventScroll: true });
    if (this.onPanelOpened) this.onPanelOpened(id);
    this.audio.play('ui-open', { volume: 0.4 });
  }

  closeTopPanel() {
    const id = this.stack.pop();
    if (!id) return null;
    this.hide(id);
    this.dialogue.setPaused('panel', this.panelOpen);
    if (id === 'confirm-screen') $('confirm-yes').onclick = null;
    if (id === 'keypad-screen') { clearTimeout(this._keypadTimer); this.onKeypadSubmit = null; }
    if (id === 'power-grid-screen') this._powerGrid = null;
    this.audio.play('ui-close', { volume: 0.4 });
    if (this.onPanelClosed) this.onPanelClosed(id);
    if (!document.pointerLockElement && this._panelFocus?.isConnected) this._panelFocus.focus({ preventScroll: true });
    return id;
  }

  closeAllPanels() {
    while (this.stack.length) this.hide(this.stack.pop());
    clearTimeout(this._keypadTimer);
    this.onKeypadSubmit = null;
    this._powerGrid = null;
    $('confirm-yes').onclick = null;
    this._panelFocus = null;
    this.dialogue.setPaused('panel', false);
  }
  get panelOpen() { return this.stack.length > 0; }

  resetTransient() {
    this.closeAllPanels();
    this.stopSay();
    this.clearMessage();
    this.hideTutorial();
    this.setPrompt(null);
    this.setInteractionGuide(false);
    this.setHint('');
  }
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

  /** Important instruction cards share the same explicit acknowledgement queue. */
  tutorial(card) {
    this._tutorial = card;
    this.dialogue.enqueue([{ view: 'tutorial-card', card }]);
    this.audio.play('ui-open', { volume: .5 });
  }
  toggleTutorial() {
    if (this.dialogue.current?.view === 'tutorial-card') this.dialogue.advance();
    else if (this._tutorial && !this.dialogue.active) this.tutorial(this._tutorial);
  }
  hideTutorial() { $('tutorial-card').classList.add('hidden'); this._tutorial = null; }

  /** Optional distance aid: each era starts with it hidden. The 3D minimap (M) is independent. */
  _bindDistanceHint() {
    const toggle = $('distance-hint-toggle');
    const menu = $('distance-hint-menu');
    $('distance-hint-action').addEventListener('click', () => this.setDistanceMapEnabled(true));
    toggle.addEventListener('click', () => {
      if (this._distanceMapEnabled) this.setDistanceMapEnabled(false);
      else {
        const open = menu.classList.toggle('hidden') === false;
        toggle.setAttribute('aria-expanded', String(open));
      }
    });
    this.setDistanceMapEnabled(false);
  }

  get distanceMapEnabled() { return this._distanceMapEnabled; }

  setDistanceMapEnabled(on) {
    this._distanceMapEnabled = !!on;
    const toggle = $('distance-hint-toggle');
    const menu = $('distance-hint-menu');
    toggle.textContent = on ? 'Hint Off' : 'Hint';
    toggle.setAttribute('aria-pressed', String(!!on));
    toggle.setAttribute('aria-expanded', 'false');
    menu.classList.add('hidden');
    if (!on) this.setWaypoint(false);
  }

  toggleDistanceMap() { this.setDistanceMapEnabled(!this._distanceMapEnabled); }

  /** A non-directional distance readout. Never points at or tracks clues. */
  setWaypoint(visible, x = 0, y = 0, dist = 0, subject = 'clue') {
    const el = $('waypoint');
    if (!visible) { if (!this._cache.wpHidden) { el.classList.add('hidden'); this._cache.wpHidden = true; } return; }
    if (this._cache.wpHidden !== false) { el.classList.remove('hidden'); this._cache.wpHidden = false; }
    this._set('wp-dist', 'text', `${Math.round(dist)} m to ${subject}`);
  }
  setHint(text) { this._set('hint', 'text', text || ''); }

  /** One nearby object at a time; its label always agrees with the E target. */
  setInteractionGuide(visible, x = 0, y = 0, label = '', status = '', distance = 0, angle = null) {
    this._set('interaction-guide', 'hidden', !visible);
    if (!visible) return;
    const el = $('interaction-guide');
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    el.classList.toggle('ready', status === 'ready');
    $('interaction-arrow').style.transform = `rotate(${angle ?? 0}rad)`;
    this._set('interaction-name', 'text', label);
    this._set('interaction-help', 'text', status === 'ready' ? 'Press E now' :
      status === 'blocked' ? 'Move to an accessible side' :
      status === 'turn' ? 'Face the object and press E' : `Move closer · ${Math.ceil(distance)} m`);
  }

  setStability(frac, secondsLeft) {
    this._set('stability-fill', 'width', `${Math.max(0, frac * 100).toFixed(1)}%`);
    const low = frac < 0.2;
    if (this._cache.low !== low) { this._cache.low = low; $('stability-fill').classList.toggle('low', low); }
    const s = Math.max(0, Math.ceil(secondsLeft));
    this._set('stability-time', 'text', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  }

  setCores(n) {
    document.querySelectorAll('.core-slot').forEach((el, i) => el.classList.toggle('lit', i < n));
    this._set('core-count', 'text', `Cores ${n} / 3`);
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

  clearMessage() { clearTimeout(this._messageTimer); $('message-banner').classList.remove('active'); }

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
   * word of play and narrative line remain until acknowledged, like captions.
   */
  eraCard(card) {
    this.dialogue.enqueue([{ view: 'era-card', card }]);
  }

  /* ----------------------------- journal ---------------------------- */
  resetJournal() { this.journal = []; this._renderJournal(); }

  removeJournalEntries(keys) {
    const removed = new Set(keys);
    this.journal = this.journal.filter(entry => !removed.has(entry.key));
    this._renderJournal();
  }

  addJournal(html, key) {
    const existing = key && this.journal.find(entry => entry.key === key);
    if (existing?.html === html) return;
    if (existing) existing.html = html;
    else this.journal.push({ html, key });
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
    // Display tablet clues in altar order (I, II, III), even when the player
    // discovers III before II. Keep the saved entries themselves unchanged.
    const hours = new Map(journalTablets(this.journal).map(clue => [`tablet-${clue.spot}`, clue.hour]));
    const tablets = this.journal.filter(entry => hours.has(entry.key))
      .sort((a, b) => hours.get(a.key) - hours.get(b.key));
    let tabletIndex = 0;
    const entries = this.journal.map(entry => hours.has(entry.key) ? tablets[tabletIndex++] : entry);
    for (const j of entries) {
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
      if (!this.isOpen('keypad-screen') || this._keypadAccepted) return;
      const disp = $('keypad-display');
      disp.classList.remove('error', 'ok');
      if (k === 'clear') this._keypadValue = '';
      else if (k === 'enter') {
        const ok = this.onKeypadSubmit ? this.onKeypadSubmit(this._keypadValue) : false;
        disp.classList.add(ok ? 'ok' : 'error');
        this.audio.play(ok ? 'ui-confirm' : 'ui-error');
        if (!ok) this._keypadValue = '';
        else {
          this._keypadAccepted = true;
          clearTimeout(this._keypadTimer);
          this._keypadTimer = setTimeout(() => { if (this.isOpen('keypad-screen')) this.closeTopPanel(); }, 700);
        }
      } else if (this._keypadValue.length < 4) this._keypadValue += k;
      this.audio.play('keypad', { volume: 0.6 });
      disp.textContent = (this._keypadValue + '____').slice(0, 4);
    };
    document.querySelectorAll('#keypad-screen [data-key]').forEach((b) => b.addEventListener('click', () => press(b.dataset.key)));
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen('keypad-screen') || e.repeat) return;
      if (/^Digit\d$|^Numpad\d$/.test(e.code)) press(e.code.slice(-1));
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') press('enter');
      else if (e.code === 'Backspace') press('clear');
    });
  }

  openKeypad(onSubmit) {
    clearTimeout(this._keypadTimer);
    this._keypadValue = '';
    this._keypadAccepted = false;
    $('keypad-display').textContent = '____';
    $('keypad-display').classList.remove('error', 'ok');
    this.onKeypadSubmit = onSubmit;
    this.openPanel('keypad-screen');
  }

  /* ------------------------- full-screen power routing ------------- */
  _bindPowerGrid() {
    // Pointer lock is released by openPanel. Use ordinary buttons, so the
    // grid also works on touchscreens and while keyboard focus is active.
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen('power-grid-screen') || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      const digit = /^Digit([1-9])$/.exec(e.code) || /^Numpad([1-9])$/.exec(e.code);
      if (digit) {
        e.preventDefault();
        this.rotatePowerTile(Number(digit[1]) - 1);
      }
    });
  }

  openPowerGrid(controller) {
    // The level owns rotations and the original powered-tile algorithm.
    // UI is only a view, and never exposes a shortcut to solve the puzzle.
    if (!controller || typeof controller.getState !== 'function' || typeof controller.rotate !== 'function') return;
    this._powerGrid = controller;
    this._renderPowerGrid();
    this.openPanel('power-grid-screen');
  }

  rotatePowerTile(index) {
    if (!this.isOpen('power-grid-screen') || !this._powerGrid) return;
    const snapshot = this._powerGrid.getState();
    if (snapshot.solved || !Number.isInteger(index) || index < 0 || index >= 9) return;
    this._powerGrid.rotate(index);
    this._renderPowerGrid(index);
  }

  _renderPowerGrid(focusTile = -1) {
    if (!this._powerGrid) return;
    const { tiles, litCount, solved } = this._powerGrid.getState();
    const container = $('power-grid-tiles');
    if (!Array.isArray(tiles) || tiles.length !== 9) return;
    container.innerHTML = '';
    const bits = [[1, 'M50 50 V5'], [2, 'M50 50 H95'], [4, 'M50 50 V95'], [8, 'M50 50 H5']];
    tiles.forEach((t, i) => {
      // t.mask comes from a fixed in-game 4-bit pipe model, not user input.
      const mask = t.mask & 15;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'power-tile';
      button.classList.toggle('powered', !!t.powered);
      button.classList.toggle('complete', !!solved);
      button.disabled = !!solved;
      button.dataset.index = String(i);
      button.setAttribute('aria-label', `Pipe ${i + 1}, ${t.type}, ${t.powered ? 'carrying power' : 'unpowered'}. Rotate clockwise.`);
      button.setAttribute('title', `Tile ${i + 1} · rotate clockwise`);
      button.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><rect x="2" y="2" width="96" height="96" rx="10" class="tile-border"/><g class="tile-pipes">${bits.filter(([bit]) => (mask & bit)).map(([, path]) => `<path d="${path}"/>`).join('')}</g><circle cx="50" cy="50" r="8" class="tile-hub"/></svg><span class="power-tile-number">${i + 1}</span><span class="power-tile-rotate" aria-hidden="true">↻</span>`;
      button.addEventListener('click', () => this.rotatePowerTile(i));
      container.appendChild(button);
    });
    $('power-grid-status').textContent = solved
      ? 'POWER RESTORED — GRID IN is connected to VAULT OUT!'
      : `Live tiles: ${litCount} / 9 · Turn the pipes to carry power from left to right`;
    $('power-grid-status').classList.toggle('solved', !!solved);
    $('power-grid-instructions').textContent = solved
      ? 'Excellent! The facility is coming back online. Return to the game to continue.'
      : 'Click any tile to rotate it 90° clockwise (or press 1–9). Bright cyan pipes carry electricity. The pipe ends must meet to form a continuous route.';
    if (focusTile >= 0 && !solved) container.children[focusTile]?.focus({ preventScroll: true });
    if (solved) $('power-grid-close').focus({ preventScroll: true });
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
    settings.onChange((key, value) => {
      const input = document.querySelector(`[data-setting="${key}"]`);
      if (input) { if (input.type === 'checkbox') input.checked = !!value; else input.value = value; }
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

  /* ------------------------- journey statistics ---------------------- */
  /* The final record, shown once the ending story and credits are done.
     Four sections — one per era plus the whole journey — each acknowledged
     with Enter/click before the next appears, like the dialogue system. */

  _bindJourneyStats() {
    const advance = () => this._advanceJourneyStats();
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen('journey-stats-screen') || e.repeat || this._statsFlow?.review) return;
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') { e.preventDefault(); advance(); }
    });
    $('journey-stats-screen').addEventListener('click', () => {
      if (!this._statsFlow?.review) advance();
    });
    // The button stops the bubble so a click cannot advance twice.
    $('journey-stats-continue').addEventListener('click', (e) => {
      e.stopPropagation(); this._advanceJourneyStats({ explicit: true });
    });
  }

  showJourneyStats(summary, onDone, { review = false } = {}) {
    clearTimeout(this._statsRevealTimer);
    const body = $('journey-stats-body');
    body.innerHTML = '';
    $('journey-stats-continue').classList.add('hidden');
    $('journey-stats-continue').textContent = review ? 'Back to results' : 'Continue';
    $('journey-stats-hint').textContent = review
      ? 'Scroll to review all your statistics and badges. Select Back to results when you are finished.'
      : 'Press Enter / Click to continue';
    const meta = [
      ['I', 'The Past', 'Temple of the First Hour'],
      ['II', 'The Present', 'Blackout at the Facility'],
      ['III', 'The Future', 'Spire of 2187'],
    ];
    const sections = [];
    summary.levels.forEach((rec, i) => sections.push(this._statsLevelSection(i, meta[i], rec, summary.scores[i])));
    sections.push(this._statsOverallSection(summary));
    for (const s of sections) { s.classList.add('hidden'); body.appendChild(s); }
    this._statsFlow = { sections, index: -1, onDone, last: 0, review };
    this.show('journey-stats-screen');
    body.parentElement.scrollTop = 0;
    if (review) {
      // All previously seen sections are readable at once. Background clicks
      // do nothing; only the explicit return button closes the review.
      this._statsFlow.index = sections.length - 1;
      sections.forEach((section, i) => this._revealStatsSection(section, i === sections.length - 1));
      $('journey-stats-continue').classList.remove('hidden');
      $('journey-stats-continue').focus({ preventScroll: true });
    } else {
      // Reveal the first era immediately; each Enter/click shows the next.
      const flow = this._statsFlow;
      this._statsRevealTimer = setTimeout(() => {
        if (this._statsFlow === flow) this._advanceJourneyStats();
      }, 150);
    }
  }

  _advanceJourneyStats({ explicit = false } = {}) {
    const flow = this._statsFlow;
    if (!flow || !this.isOpen('journey-stats-screen') || (flow.review && !explicit)) return;
    const now = performance.now();
    if (now - flow.last < 260) return;          // one reveal per acknowledgement
    flow.last = now;
    if (flow.index < flow.sections.length - 1) {
      flow.index++;
      const last = flow.index === flow.sections.length - 1;
      this._revealStatsSection(flow.sections[flow.index], last);
      if (last) $('journey-stats-continue').classList.remove('hidden');
      else this.audio.play('ui-open', { volume: 0.5 });
    } else {
      const done = flow.onDone;
      this._statsFlow = null;
      this.hide('journey-stats-screen');
      if (done) done();
    }
  }

  _revealStatsSection(section, isOverall) {
    section.classList.remove('hidden');
    this._animateStatsCounters(section);
    const badge = section.querySelector('.rank-badge');
    if (badge) setTimeout(() => {
      badge.classList.add('reveal');
      this.audio.play(isOverall ? 'core-get' : 'ui-confirm', { volume: isOverall ? 0.8 : 0.7 });
    }, 620);
  }

  _animateStatsCounters(section) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    section.querySelectorAll('.js-value[data-count]').forEach((el) => {
      const target = Number(el.dataset.count) || 0;
      const total = el.dataset.total != null ? Number(el.dataset.total) : null;
      const fmt = (v) => this._statsFormat(el.dataset.format, v, total);
      if (reduce || !target) { el.textContent = fmt(target); return; }
      const t0 = performance.now();
      const dur = 900;
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur);
        el.textContent = fmt(target * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    // Bars start at width 0 in CSS; two frames in, the transition animates them.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      section.querySelectorAll('.js-bar i[data-w]').forEach((i) => { i.style.width = `${i.dataset.w}%`; });
    }));
  }

  _statsFormat(format, v, total) {
    if (format === 'time') { const s = Math.round(v); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
    if (format === 'm') return `${Math.round(v)} m`;
    if (total != null) return `${Math.round(v)} / ${total}`;
    return String(Math.round(v));
  }

  _statsTile(format, count, total, label, barPct = null) {
    const t = document.createElement('div');
    t.className = 'js-stat';
    const v = document.createElement('span');
    v.className = 'js-value';
    v.dataset.count = String(Math.round(count) || 0);
    v.dataset.format = format;
    if (total != null) v.dataset.total = String(Math.round(total));
    v.textContent = this._statsFormat(format, 0, total);
    const l = document.createElement('span');
    l.className = 'js-label';
    l.textContent = label;
    t.append(v, l);
    if (barPct != null && barPct > 0) {
      const fill = document.createElement('i');
      fill.dataset.w = String(Math.min(100, Math.round(barPct)));
      const bar = document.createElement('div');
      bar.className = 'js-bar';
      bar.appendChild(fill);
      t.appendChild(bar);
    }
    return t;
  }

  _statsHead(numeral, name, sub, rank, score) {
    const head = document.createElement('header');
    head.className = 'js-head';
    const n = document.createElement('span');
    n.className = 'js-numeral title-font';
    n.textContent = numeral;
    const div = document.createElement('div');
    const h = document.createElement('h3');
    h.textContent = name;
    const p = document.createElement('p');
    p.className = 'js-sub';
    p.textContent = `${sub} · score ${score} / 100`;
    div.append(h, p);
    const badge = document.createElement('span');
    badge.className = 'rank-badge';
    badge.dataset.rank = rank;
    badge.textContent = rank;
    head.append(n, div, badge);
    return head;
  }

  _statsLevelSection(i, [numeral, name, sub], rec, score) {
    const rank = rankFor(score);
    const s = document.createElement('section');
    s.className = 'js-section';
    s.appendChild(this._statsHead(numeral, name, sub, rank, score));
    const title = document.createElement('p');
    title.className = 'js-title';
    title.innerHTML = `Title earned — <b>${LEVEL_TITLES[i][rank]}</b>`;
    s.appendChild(title);
    const grid = document.createElement('div');
    grid.className = 'js-grid';
    grid.append(
      this._statsTile('clues', rec.clues, rec.cluesTotal, 'Clues found',
        rec.cluesTotal > 0 ? (100 * rec.clues) / rec.cluesTotal : 0),
      this._statsTile('puzzles', rec.puzzles, rec.puzzlesTotal, 'Puzzles solved',
        rec.puzzlesTotal > 0 ? (100 * rec.puzzles) / rec.puzzlesTotal : 0),
      this._statsTile('time', rec.time, null, 'Time in era',
        (100 * PAR_TIMES[i]) / Math.max(1, rec.time)),
      this._statsTile('int', (rec.falls || 0) + (rec.shocks || 0), null, 'Falls & shocks'),
      this._statsTile('int', rec.rewinds, null, 'Era rewinds'),
      this._statsTile('int', rec.checkpoints, null, 'Checkpoints'),
      this._statsTile('m', rec.distance, null, 'Distance walked'),
    );
    s.appendChild(grid);
    return s;
  }

  _statsOverallSection(summary) {
    const rank = rankFor(summary.overall);
    const t = summary.totals;
    const s = document.createElement('section');
    s.className = 'js-section';
    s.appendChild(this._statsHead('∞', 'The Whole Adventure', 'All three eras combined', rank, summary.overall));
    const title = document.createElement('p');
    title.className = 'js-title';
    title.innerHTML = `Title earned — <b>${OVERALL_TITLES[rank]}</b>`;
    s.appendChild(title);
    const medal = document.createElement('span');
    medal.className = `js-medal ${summary.medal}`;
    medal.textContent = `${summary.medal[0].toUpperCase()}${summary.medal.slice(1)} medal of the hourglass`;
    s.appendChild(medal);
    const grid = document.createElement('div');
    grid.className = 'js-grid';
    grid.append(
      this._statsTile('time', t.time, null, 'Journey time',
        (100 * t.parTotal) / Math.max(1, t.time)),
      this._statsTile('clues', t.clues, t.cluesTotal, 'Clues found',
        t.cluesTotal > 0 ? (100 * t.clues) / t.cluesTotal : 0),
      this._statsTile('puzzles', t.puzzles, t.puzzlesTotal, 'Puzzles solved',
        t.puzzlesTotal > 0 ? (100 * t.puzzles) / t.puzzlesTotal : 0),
      this._statsTile('int', t.falls, null, 'Falls through time'),
      this._statsTile('int', t.shocks, null, 'Shocks taken'),
      this._statsTile('int', t.rewinds, null, 'Era rewinds'),
      this._statsTile('int', t.checkpoints, null, 'Checkpoints reached'),
      this._statsTile('m', t.distance, null, 'Distance walked'),
    );
    s.appendChild(grid);
    const ach = document.createElement('div');
    ach.className = 'js-achievements';
    summary.achievements.forEach((a, i) => {
      const el = document.createElement('div');
      el.className = `js-ach ${a.tier}`;
      el.style.animationDelay = `${i * 0.12}s`;
      const b = document.createElement('b');
      b.textContent = a.name;
      const d = document.createElement('span');
      d.textContent = a.detail;
      el.append(b, d);
      ach.appendChild(el);
    });
    s.appendChild(ach);
    return s;
  }


  /* ----------------------------- cinematics ------------------------- */
  cinema(on, letterbox = true, hint = 'X — skip cinematic · Esc — pause') {
    $('cinema').classList.toggle('hidden', !on);
    $('cinema').classList.toggle('no-bars', !letterbox);
    $('skip-hint').textContent = hint;
    $('skip-cinematic').classList.toggle('hidden', !on);
  }

  /** Legacy durations are accepted for unchanged story scripts, never used to dismiss text. */
  caption(speaker, text, seconds = 4.5, { inGame = false, onDone = null } = {}) {
    if (!text) { this.stopSay(); return; }
    this.dialogue.enqueue([{ view: 'caption', speaker, text, inGame, onDone }]);
  }

  /** New thoughts append: an unread line is never replaced by another trigger. */
  say(lines) {
    this.dialogue.enqueue(lines.map(([speaker, text]) => ({ view: 'caption', speaker, text, inGame: true })));
  }

  stopSay() { this.dialogue.clear(); }
  afterDialogue(fn) { this.dialogue.whenIdle(fn); }

  _renderDialogue(entry) {
    if (entry.view === 'era-card') {
      const card = entry.card;
      $('era-card-numeral').textContent = card.numeral;
      $('era-card-title').textContent = card.title;
      $('era-card-sub').textContent = card.sub;
      $('era-card-tag').textContent = card.verb ? `${card.tag || ''} — ${card.verb}` : (card.tag || '');
      $('era-card-line').textContent = card.line || '';
    } else if (entry.view === 'tutorial-card') {
      $('tut-kicker').textContent = entry.card.kicker || 'How to play';
      $('tut-title').textContent = entry.card.title;
      $('tut-body').innerHTML = entry.card.html;
      $('tut-hint-reminder').classList.toggle('hidden', entry.card.html.includes('<kbd>N</kbd>'));
    } else {
      const box = $('caption');
      box.classList.toggle('in-game', !!entry.inGame);
      box.classList.toggle('narrator', !entry.speaker);
      $('caption-speaker').textContent = entry.speaker || '';
      $('caption-text').textContent = entry.text;
      box.style.animation = 'none'; void box.offsetWidth; box.style.animation = '';
    }
  }

  endCard(on) { $('end-card').classList.toggle('hidden', !on); }

  rollCredits(on) {
    const roll = $('credits-roll');
    if (!on) { roll.classList.add('hidden'); roll.classList.remove('rolling'); return; }
    const inner = roll.querySelector('.roll-inner');
    inner.innerHTML = '<h2>The Three Worlds of Time</h2><p>The Broken Hourglass</p>'
      + '<h2>A Wits CGV group project</h2><p>COMS3006A · COMS3025A</p>'
      + document.getElementById('developer-credits').outerHTML.replace('id="developer-credits"', '')
      + '<h2>Built with</h2>' + document.getElementById('credits-list').outerHTML.replace('id="credits-list"', '')
      + '<h2>Thank you for playing</h2>';
    roll.classList.remove('hidden', 'rolling');
    void roll.offsetWidth;
    roll.classList.add('rolling');
  }
  savedNotice(text = 'Timeline Saved', error = false) {
    const el = $('save-notice'); el.textContent = text; el.classList.toggle('error', error); this.show('save-notice');
    clearTimeout(this._saveTimer); this._saveTimer = setTimeout(() => this.hide('save-notice'), error ? 6500 : 2400);
  }

  setContinue(result) {
    const button = $('continue-button'); button.disabled = result.status !== 'valid';
    const s = result.save;
    $('save-summary').textContent = s ? (s.status === 'complete' ? 'Journey complete — view your ending' :
      `${['The Past', 'The Present', 'The Future'][s.era]} · ${s.eras[s.era].label}`) :
      result.status === 'corrupt' ? 'Saved journey could not be read. New Journey will ask before replacing it.' :
      result.status === 'unavailable' ? 'Saving is unavailable in this browser.' : 'Your progress is saved on this browser and device.';
  }

  confirm(title, message, action, accept = 'Start New Journey') {
    $('confirm-title').textContent = title; $('confirm-message').textContent = message;
    $('confirm-yes').textContent = accept;
    $('confirm-yes').onclick = () => { $('confirm-yes').onclick = null; this.closeTopPanel(); action(); };
    this.openPanel('confirm-screen');
  }

  setPauseLevel(text) { $('pause-level').textContent = text; }
}
