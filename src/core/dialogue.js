/** One input owner and one reminder timer for every caption and story card. */
export class Dialogue {
  constructor({ render, clock = { now: () => performance.now(), set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) } }) {
    this.render = render;
    this.clock = clock;
    this.queue = [];
    this.idle = [];
    this.current = null;
    this.pauses = new Set();
    this.heldEnter = new Set();
    this.instructed = false;
    this.timer = null;
    this.views = Object.fromEntries(['caption', 'era-card'].map(id => [id, {
      root: document.getElementById(id),
      instruction: document.getElementById(id + '-instruction'),
      reminder: document.getElementById(id + '-reminder'),
    }]));
    this.onKeyDown = e => {
      if (!['Enter', 'NumpadEnter'].includes(e.code)) return;
      if (this.heldEnter.has(e.code)) { this.consume(e); return; }
      if (!this.enabled) return;
      this.consume(e);
      this.heldEnter.add(e.code);
      if (!e.repeat && !e.isComposing) this.advance();
    };
    this.onKeyUp = e => { if (this.heldEnter.delete(e.code)) this.consume(e); };
    this.onMouseDown = e => {
      this.clickEntry = null;
      if (e.button !== 0 || !this.acceptsClick(e)) return;
      this.clickEntry = this.current;
      this.consume(e); // Before the player's mousedown interaction handler.
    };
    this.onClick = e => {
      if (e.button !== 0 || (!this.clickEntry && !this.acceptsClick(e))) return;
      const entry = this.clickEntry;
      this.clickEntry = null;
      this.consume(e);
      // Do not consume a new line using the click which opened it.
      // detail=0 is native keyboard/assistive activation of the Continue button.
      if (this.enabled && (entry === this.current || (e.detail === 0 && !this.heldEnter.size))) this.advance();
    };
    this.onBlur = () => { this.heldEnter.clear(); this.clickEntry = null; this.setPaused('focus', true); };
    this.onFocus = () => this.setPaused('focus', false);
    this.onVisibility = () => this.setPaused('visibility', document.hidden);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('mousedown', this.onMouseDown, true);
    window.addEventListener('click', this.onClick, true);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('focus', this.onFocus);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.onVisibility();
  }

  get active() { return !!this.current; }
  get enabled() { return this.active && !this.pauses.size; }
  consume(e) { e.preventDefault(); e.stopImmediatePropagation(); }
  acceptsClick(e) {
    return this.enabled && (!!document.pointerLockElement || this.views[this.current.view].root.contains(e.target));
  }

  enqueue(entries) {
    this.queue.push(...entries);
    if (!this.active) this.next();
  }

  next() {
    if (this.active) return;
    this.current = this.queue.shift() || null;
    if (this.current) {
      this.remaining = 10000;
      this.reminded = false;
      this.render(this.current);
      this.paint();
      this.armReminder();
    } else {
      this.paint();
      // A completion may start another sequence; later continuations wait for it.
      while (!this.active && this.idle.length) this.idle.shift()();
    }
  }

  advance() {
    if (!this.enabled) return false;
    const done = this.current.onDone;
    this.stopTimer();
    this.current = null;
    this.instructed = true;
    this.paint();
    if (done) done();
    this.next();
    return true;
  }

  whenIdle(fn) { if (this.active) this.idle.push(fn); else fn(); }

  armReminder() {
    if (!this.enabled || this.reminded || this.timer !== null) return;
    const entry = this.current;
    this.deadline = this.clock.now() + this.remaining;
    this.timer = this.clock.set(() => {
      this.timer = null;
      if (this.current !== entry || !this.enabled) return;
      this.reminded = true;
      this.paint();
    }, this.remaining);
  }

  stopTimer() {
    if (this.timer !== null) this.clock.clear(this.timer);
    this.timer = null;
  }

  setPaused(reason, paused) {
    const wasEnabled = this.enabled;
    if (paused) this.pauses.add(reason); else this.pauses.delete(reason);
    if (wasEnabled && !this.enabled && this.timer !== null) {
      this.remaining = Math.max(0, this.deadline - this.clock.now());
      this.stopTimer();
    }
    this.paint();
    this.armReminder();
  }

  paint() {
    for (const [id, view] of Object.entries(this.views)) {
      const visible = this.enabled && this.current.view === id;
      view.root.classList.toggle('hidden', !visible);
      view.instruction.classList.toggle('hidden', !visible || this.instructed);
      view.reminder.classList.toggle('hidden', !visible || !this.reminded);
    }
  }

  clear() {
    this.stopTimer();
    this.current = null;
    this.queue.length = 0;
    this.idle.length = 0;
    this.clickEntry = null;
    this.reminded = false;
    this.paint();
  }

  dispose() {
    this.clear();
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('mousedown', this.onMouseDown, true);
    window.removeEventListener('click', this.onClick, true);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('focus', this.onFocus);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
}
