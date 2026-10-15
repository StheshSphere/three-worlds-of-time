import { settings } from './settings.js';
import { Dialogue } from './dialogue.js';

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
