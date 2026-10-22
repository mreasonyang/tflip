import { normalizeOptions, sample } from '../core/index.js';
import type {
  Anchor, Animator, CancelReason, MotionEffect, MotionOptions, NormalizedTrajectory,
  Playback, PlaybackEventType, PlaybackListener, PlaybackResult, PlaybackStatus, Point, Pose,
} from '../types.js';

export type { Animator, MotionOptions, Playback, PlaybackEvent, PlaybackListener, PlaybackResult, Sequence } from '../types.js';
export { sequence } from './sequence.js';

interface Lane { active?: Controller; waiting: Controller[] }
const lanes = new WeakMap<Element, Lane>();
const isElement = (value: unknown): value is Element =>
  typeof value === 'object' && value !== null && (value as Element).nodeType === 1 && typeof (value as Element).getBoundingClientRect === 'function';
const finitePositive = (n: number, label: string) => {
  if (!Number.isFinite(n) || n <= 0) throw new RangeError(`${label} must be a finite number greater than zero`);
};
const terminal = (status: PlaybackStatus) => status === 'finished' || status === 'cancelled';
const callbacks: Record<PlaybackEventType, keyof MotionOptions> = {
  start: 'onStart', land: 'onLand', finish: 'onFinish', cancel: 'onCancel', update: 'onUpdate',
};

interface Prepared {
  document: Document; window: Window & typeof globalThis; mode: 'in-place' | 'transfer'; visual?: HTMLElement;
  trajectory: NormalizedTrajectory; sources: Element[]; key?: Element;
}

function prepare(options: MotionOptions): Prepared {
  const candidate = options.element ?? (isElement(options.from) ? options.from : isElement(options.to) ? options.to : undefined);
  const document = candidate?.ownerDocument ?? (typeof globalThis.document !== 'undefined' ? globalThis.document : undefined);
  if (!document?.defaultView) throw new Error('Tflip play() requires a browser Document; importing the package during SSR is safe.');
  const window = document.defaultView;
  if (options.element && !(options.element instanceof window.HTMLElement)) throw new TypeError('element must be an HTMLElement');
  const mode = options.mode ?? (options.visual ? 'transfer' : 'in-place');
  if (mode !== 'in-place' && mode !== 'transfer') throw new TypeError('Unknown motion mode');
  if (mode === 'in-place' && (!options.element || !(options.element instanceof window.HTMLElement))) throw new TypeError('In-place motion requires a dedicated HTMLElement wrapper');
  if (mode === 'transfer' && typeof options.visual !== 'function') throw new TypeError('Transfer motion requires a fresh detached visual factory');
  if (mode === 'transfer' && !options.from && !options.element) throw new TypeError('Transfer motion requires a from anchor or element');
  for (const [value, choices, name] of [
    [options.repeat, ['replace', 'ignore', 'queue'], 'repeat'],
    [options.layout, ['cancel', 'freeze', 'follow'], 'layout'],
    [options.reducedMotion, ['system', 'always', 'never'], 'reducedMotion'],
    [options.backface, ['visible', 'hidden'], 'backface'],
  ] as const) if (value !== undefined && !(choices as readonly string[]).includes(value)) throw new TypeError(`Unknown ${name} option`);
  finitePositive(options.speed ?? 1, 'speed');
  finitePositive(options.perspective ?? 900, 'perspective');
  if (options.size) {
    finitePositive(options.size.width, 'size.width'); finitePositive(options.size.height, 'size.height');
  }
  const effects = options.effects ? (Array.isArray(options.effects) ? options.effects : [options.effects]) : [];
  if (effects.some(effect => typeof effect !== 'function')) throw new TypeError('effects must contain factories');
  for (const name of Object.values(callbacks)) if (options[name] !== undefined && typeof options[name] !== 'function') throw new TypeError(`${name} must be a function`);
  const signal = options.signal;
  if (signal !== undefined && (!signal || typeof signal !== 'object' || typeof signal.aborted !== 'boolean'
    || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
    throw new TypeError('signal must be an AbortSignal');
  }
  const sources = [...new Set([options.element, options.from, options.to].filter(isElement))];
  for (const source of sources) {
    if (source.ownerDocument !== document) throw new TypeError('All anchors must share the same Document');
    if (!source.isConnected) throw new TypeError('Motion anchors must be connected to their Document');
  }
  const point = (anchor?: Anchor): Point | undefined => {
    if (!isElement(anchor)) return anchor;
    const rect = anchor.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  const from = point(options.from ?? options.element) ?? { x: 0, y: 0 };
  const trajectory = normalizeOptions({ ...options, from, to: point(options.to) ?? from });
  const visual = mode === 'transfer' ? options.visual!() : undefined;
  if (visual && (!(visual instanceof window.HTMLElement) || visual.parentNode || visual.isConnected || visual.ownerDocument !== document)) {
    throw new TypeError('visual() must return a fresh detached HTMLElement in the same Document');
  }
  if (mode === 'transfer' && !visual) throw new TypeError('visual() must return a fresh detached HTMLElement');
  return { document, window, mode, visual, trajectory, sources, key: options.element ?? (isElement(options.from) ? options.from : undefined) };
}

/** Returns immediately; start callbacks run after the current JavaScript turn. */
export function play(options: MotionOptions): Playback {
  // Ignore is an identity operation: no new visual is created for an ignored run.
  const key = options.element ?? (isElement(options.from) ? options.from : undefined);
  const existing = key ? lanes.get(key) : undefined;
  if (options.repeat === 'ignore' && existing?.active && !terminal(existing.active.status)) return existing.active;
  const prepared = prepare(options);
  const controller = new Controller(options, prepared);
  // Subscription can fail for malformed JavaScript inputs. Do this before
  // changing the lane or scheduling work so setup failure leaves no live run.
  controller.bindAbort();
  let lane: Lane | undefined;
  if (key) {
    lane = lanes.get(key) ?? { waiting: [] };
    lanes.set(key, lane);
    controller.lane = lane;
    if ((options.repeat ?? 'replace') === 'replace') {
      // Register the replacement before old callbacks can reenter play().
      const superseded = [lane.active, ...lane.waiting].filter((item): item is Controller => !!item);
      lane.active = controller; lane.waiting = [];
      for (const item of superseded) item.cancel('replaced');
    } else if (lane.active && !terminal(lane.active.status)) lane.waiting.push(controller);
    else lane.active = controller;
  }
  if (options.signal?.aborted) controller.cancel('aborted');
  // Queued runs also observe detachment; only the active run mounts visuals.
  if (!terminal(controller.status)) controller.scheduleActivation();
  return controller;
}

class Controller implements Playback {
  lane?: Lane;
  private _status: PlaybackStatus = 'queued';
  private time = 0;
  private speed: number;
  private shouldRun: boolean;
  private initialized = false;
  private observingSources = false;
  private started = false;
  private landed = false;
  private frame: number | undefined;
  private lastTimestamp: number | undefined;
  private seekVersion = 0;
  private trajectory: NormalizedTrajectory;
  private pose: Pose;
  private base: Point;
  private appliedX = 0;
  private appliedY = 0;
  private overlay?: HTMLElement;
  private shadow?: HTMLElement;
  private motionNode?: HTMLElement;
  private restore?: () => void;
  private effects: MotionEffect[] = [];
  private cleanups: (() => void)[] = [];
  private listeners = new Map<PlaybackEventType, Set<PlaybackListener>>();
  private dispatching = new Set<PlaybackEventType>();
  private media?: MediaQueryList;
  private reduced = false;
  private resolve!: (result: PlaybackResult) => void;
  readonly finished: Promise<PlaybackResult>;

  constructor(private options: MotionOptions, private prepared: Prepared) {
    this.trajectory = prepared.trajectory;
    this.pose = sample(0, this.trajectory);
    this.base = this.elementCenter();
    this.shouldRun = options.autoplay !== false;
    this.speed = options.speed ?? 1;
    this.finished = new Promise(resolve => { this.resolve = resolve; });
  }
  get status() { return this._status; }
  get progress() { return this.duration === 0 ? (terminal(this.status) ? 1 : 0) : Math.min(1, this.time / this.duration); }
  get currentTime() { return this.time; }
  get duration() { return this.trajectory.duration; }
  private elementCenter(): Point {
    const rect = this.options.element?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2 - this.appliedX, y: rect.top + rect.height / 2 - this.appliedY } : this.trajectory.from;
  }
  bindAbort() {
    const signal = this.options.signal;
    if (!signal || terminal(this.status)) return;
    const abort = () => this.cancel('aborted');
    const remove = () => signal.removeEventListener('abort', abort);
    try { signal.addEventListener('abort', abort, { once: true }); }
    catch (error) {
      try { remove(); } catch { /* Roll back a partially registered custom signal. */ }
      throw error;
    }
    this.cleanups.push(remove);
  }
  scheduleActivation() { queueMicrotask(() => this.activate()); }
  private activate() {
    if (terminal(this.status) || this.initialized) return;
    try {
      if (this.prepared.sources.some(source => !source.isConnected)) { this.cancel('detached'); return; }
      this.observeSources();
      if (this.lane && this.lane.active !== this) return;
      this.initialized = true;
      this.measure();
      const { window } = this.prepared;
      this.media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined;
      this.reduced = this.options.reducedMotion === 'always' || (this.options.reducedMotion !== 'never' && !!this.media?.matches);
      this.installWatchers();
      this._status = this.shouldRun ? 'running' : 'paused';
      this.lastTimestamp = undefined;
      if (!this.reduced) { this.mount(); this.render(0, false); }
      if (!terminal(this.status) && this.shouldRun) this.begin();
    } catch (error) { this.fail(error); }
  }
  private observeSources() {
    if (this.observingSources) return;
    this.observingSources = true;
    const { document, window, sources } = this.prepared;
    if (sources.length && typeof window.MutationObserver === 'function' && document.documentElement) {
      const observer = new window.MutationObserver(() => {
        if (sources.some(source => !source.isConnected)) this.cancel('detached');
      });
      this.cleanups.push(() => observer.disconnect());
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }
  private measure() {
    this.base = this.elementCenter();
    const point = (anchor?: Anchor): Point | undefined => {
      if (!isElement(anchor)) return anchor;
      if (anchor === this.options.element) return this.base;
      const rect = anchor.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    const from = point(this.options.from ?? this.options.element) ?? this.trajectory.from;
    this.trajectory = normalizeOptions({ ...this.options, from, to: point(this.options.to) ?? from });
  }
  private installWatchers() {
    const { document, window, sources } = this.prepared;
    const listen = (target: EventTarget, type: string, listener: EventListener, options?: AddEventListenerOptions) => {
      target.addEventListener(type, listener, options);
      this.cleanups.push(() => target.removeEventListener(type, listener, options));
    };
    const layout = () => {
      if (terminal(this.status)) return;
      if ((this.options.layout ?? 'cancel') === 'cancel') this.cancel('layout');
      else if (this.options.layout === 'follow') {
        try { this.measure(); this.render(0, true); } catch (error) { this.fail(error); }
      }
    };
    listen(window, 'resize', layout);
    listen(document, 'scroll', layout, { capture: true, passive: true });
    listen(document, 'visibilitychange', () => {
      this.stopFrame();
      if (!document.hidden && this.status === 'running') this.scheduleFrame();
    });
    if (this.media && this.options.reducedMotion !== 'never' && this.options.reducedMotion !== 'always') {
      const changed = () => {
        this.reduced = !!this.media?.matches;
        if (this.reduced && !terminal(this.status)) { if (!this.started) this.emitStart(); this.finish(); }
      };
      if (typeof this.media.addEventListener === 'function') {
        this.media.addEventListener('change', changed);
        this.cleanups.push(() => this.media?.removeEventListener('change', changed));
      } else {
        this.media.addListener(changed); this.cleanups.push(() => this.media?.removeListener(changed));
      }
    }
    if (sources.length && typeof window.ResizeObserver === 'function') {
      const dimensions = new Map<Element, string>();
      const observer = new window.ResizeObserver(entries => {
        let changed = false;
        for (const entry of entries) {
          const size = `${entry.contentRect.width},${entry.contentRect.height}`;
          if (dimensions.has(entry.target) && dimensions.get(entry.target) !== size) changed = true;
          dimensions.set(entry.target, size);
        }
        if (changed) layout();
      });
      for (const source of sources) observer.observe(source);
      this.cleanups.push(() => observer.disconnect());
    }
  }
  private mount() {
    const { document, window, visual, mode } = this.prepared;
    if (mode === 'transfer' || this.options.shadow || this.options.effects) {
      const overlay = document.createElement('div');
      overlay.dataset.tflipOverlay = '';
      overlay.setAttribute('aria-hidden', 'true'); overlay.setAttribute('inert', '');
      Object.assign(overlay.style, { position: 'fixed', inset: '0', pointerEvents: 'none', overflow: 'visible', zIndex: '2147483646' });
      (document.body ?? document.documentElement).append(overlay);
      this.overlay = overlay;
    }
    if (this.options.shadow) {
      const shadow = document.createElement('div');
      shadow.dataset.tflipShadow = '';
      Object.assign(shadow.style, { position: 'absolute', width: '100px', height: '18px', left: '0', top: '0', borderRadius: '50%', background: 'rgba(0,0,0,.3)', filter: 'blur(8px)', pointerEvents: 'none' });
      this.overlay!.append(shadow); this.shadow = shadow;
    }
    if (mode === 'transfer') {
      this.motionNode = visual!;
      const rect = (this.options.element ?? (isElement(this.options.from) ? this.options.from : undefined))?.getBoundingClientRect();
      Object.assign(visual!.style, {
        position: 'absolute', left: '0', top: '0', margin: '0',
        width: `${this.options.size?.width ?? (rect?.width || 220)}px`, height: `${this.options.size?.height ?? (rect?.height || 140)}px`,
      });
      this.overlay!.append(visual!);
    } else {
      this.motionNode = this.options.element!;
      const style = this.motionNode.style;
      const hadStyleAttribute = this.motionNode.hasAttribute('style');
      const properties = ['transform', 'transform-origin', 'transform-style', 'backface-visibility', 'will-change'];
      const snapshot = properties.map(name => [name, style.getPropertyValue(name), style.getPropertyPriority(name)] as const);
      const node = this.motionNode;
      this.restore = () => {
        for (const [name, value, priority] of snapshot) value ? style.setProperty(name, value, priority) : style.removeProperty(name);
        if (!hadStyleAttribute && !node.getAttribute('style')) node.removeAttribute('style');
      };
    }
    Object.assign(this.motionNode!.style, { transformOrigin: 'center center', transformStyle: 'preserve-3d', backfaceVisibility: this.options.backface ?? 'visible', willChange: 'transform' });
    const factories = this.options.effects ? (Array.isArray(this.options.effects) ? this.options.effects : [this.options.effects]) : [];
    for (const factory of factories) {
      const effect = factory({ container: this.overlay!, document, width: window.innerWidth, height: window.innerHeight });
      if (!effect || typeof effect.render !== 'function' || typeof effect.dispose !== 'function') throw new TypeError('Effect factory must return render() and dispose()');
      if (terminal(this.status)) { effect.dispose(); return; }
      this.effects.push(effect);
    }
  }
  private emitStart() { if (!this.started && !terminal(this.status)) { this.started = true; this.emit('start'); } }
  private begin() {
    this.emitStart();
    if (this.status !== 'running') return;
    if (this.reduced || this.duration === 0) { this.finish(); return; }
    this.scheduleFrame();
  }
  private scheduleFrame() {
    if (this.frame !== undefined || this.status !== 'running' || this.prepared.document.hidden) return;
    this.lastTimestamp ??= this.prepared.window.performance.now();
    this.frame = this.prepared.window.requestAnimationFrame(timestamp => this.tick(timestamp));
  }
  private stopFrame() {
    if (this.frame !== undefined) this.prepared.window.cancelAnimationFrame(this.frame);
    this.frame = undefined; this.lastTimestamp = undefined;
  }
  private tick(timestamp: number) {
    this.frame = undefined;
    if (this.status !== 'running') return;
    const delta = Math.max(0, timestamp - (this.lastTimestamp ?? timestamp));
    this.lastTimestamp = timestamp;
    try {
      if (this.prepared.sources.some(source => !source.isConnected)) { this.cancel('detached'); return; }
      if (this.options.layout === 'follow') this.measure();
      const previous = this.time;
      const seekVersion = this.seekVersion;
      this.time = Math.min(this.duration, this.time + delta * this.speed);
      this.render(delta * this.speed, true);
      if (terminal(this.status)) return;
      // A callback may seek while rendering this tick. That is a new timeline
      // position, not natural elapsed-time crossing of a landing/finish boundary.
      if (seekVersion !== this.seekVersion) { this.scheduleFrame(); return; }
      const phases = this.trajectory.phases;
      const total = Object.values(phases).reduce((sum, ratio) => sum + ratio, 0);
      const landing = this.duration * (1 - phases.settle / total);
      if (!this.landed && previous < landing && this.time >= landing) { this.landed = true; this.emit('land'); }
      if (seekVersion !== this.seekVersion) { this.scheduleFrame(); return; }
      if (this.status === 'running' && this.time >= this.duration) this.finish();
      else if (this.status === 'running') this.scheduleFrame();
    } catch (error) { this.fail(error); }
  }
  private render(delta: number, notify: boolean) {
    this.pose = sample(this.time, this.trajectory);
    if (this.motionNode && !this.reduced) {
      const pose = this.pose;
      const transfer = this.prepared.mode === 'transfer';
      this.appliedX = transfer ? pose.x : pose.x - this.base.x;
      this.appliedY = transfer ? pose.y : pose.y - this.base.y;
      this.motionNode.style.transform = `translate(${this.appliedX}px, ${this.appliedY}px) ${transfer ? 'translate(-50%, -50%) ' : ''}perspective(${this.options.perspective ?? 900}px) translateZ(${pose.z}px) rotateX(${pose.rotateX}deg) rotateY(${pose.rotateY}deg) rotateZ(${pose.rotateZ}deg) scale(${pose.scaleX}, ${pose.scaleY})`;
      if (this.shadow) {
        const groundY = this.trajectory.from.y + (this.trajectory.to.y - this.trajectory.from.y) * pose.progress;
        this.shadow.style.transform = `translate(${pose.x}px, ${groundY + 48}px) translate(-50%, -50%) scale(${pose.shadowScale})`;
        this.shadow.style.opacity = String(pose.shadowOpacity);
      }
    }
    for (const effect of this.effects) {
      effect.render({ pose: this.pose, time: this.time, delta, duration: this.duration, progress: this.progress, reducedMotion: this.reduced, sample: time => sample(time, this.trajectory) });
      if (terminal(this.status)) return;
    }
    if (notify) this.emit('update');
  }
  private emit(type: PlaybackEventType, result?: PlaybackResult) {
    if (this.dispatching.has(type)) return;
    this.dispatching.add(type);
    const event = { type, playback: this, progress: this.progress, pose: this.pose, result };
    const callback = this.options[callbacks[type]] as PlaybackListener | undefined;
    const listeners = [...(this.listeners.get(type) ?? [])];
    try {
      if (callback) callback(event);
      for (const listener of listeners) {
        if (terminal(this.status) && type !== 'finish' && type !== 'cancel') break;
        listener(event);
      }
    } catch (error) { if (!terminal(this.status)) this.fail(error); }
    finally { this.dispatching.delete(type); }
  }
  private finish() {
    if (terminal(this.status)) return;
    const seekVersion = this.seekVersion;
    this.time = this.duration;
    this.pose = sample(this.time, this.trajectory);
    if (!this.landed) {
      this.landed = true;
      this.emit('land');
      if (terminal(this.status)) return;
      if (!this.reduced && (seekVersion !== this.seekVersion || this.status !== 'running')) {
        this.scheduleFrame();
        return;
      }
    }
    // Reduced motion still settles immediately, even if a landing callback
    // changes playback controls; a finished result always has the end pose.
    this.time = this.duration;
    this.pose = sample(this.time, this.trajectory);
    this.settle({ status: 'finished' });
  }
  private fail(error: unknown) { this.settle({ status: 'cancelled', reason: 'error', error }); }
  private settle(result: PlaybackResult) {
    if (terminal(this.status)) return;
    this._status = result.status;
    this.stopFrame();
    for (const cleanup of this.cleanups.splice(0)) { try { cleanup(); } catch { /* Cleanup continues for every resource. */ } }
    for (const effect of this.effects.splice(0)) { try { effect.dispose(); } catch { /* Cleanup errors cannot strand the promise. */ } }
    try { this.restore?.(); } catch { /* Continue releasing resources if caller changed the DOM. */ }
    this.restore = undefined;
    this.overlay?.remove(); this.overlay = undefined; this.motionNode = undefined; this.shadow = undefined;
    const lane = this.lane;
    if (lane) {
      lane.waiting = lane.waiting.filter(item => item !== this);
      if (lane.active === this) {
        lane.active = lane.waiting.shift();
        lane.active?.scheduleActivation();
        if (!lane.active && this.prepared.key && lanes.get(this.prepared.key) === lane) lanes.delete(this.prepared.key);
      }
    }
    this.resolve(result);
    this.emit(result.status === 'finished' ? 'finish' : 'cancel', result);
    this.listeners.clear();
  }
  pause() {
    if (terminal(this.status)) return;
    this.shouldRun = false;
    if (this.initialized) this._status = 'paused';
    this.stopFrame();
  }
  resume() {
    if (terminal(this.status)) return;
    this.shouldRun = true;
    if (!this.initialized || this.status === 'running') return;
    this._status = 'running'; this.lastTimestamp = undefined; this.begin();
  }
  cancel(reason: CancelReason = 'user') { this.settle({ status: 'cancelled', reason }); }
  dispose() { this.cancel('disposed'); }
  replay(): Playback { return play({ ...this.options, autoplay: true, repeat: 'replace' }); }
  seek(progress: number) {
    if (!Number.isFinite(progress)) throw new RangeError('progress must be finite');
    if (terminal(this.status)) return;
    this.seekVersion++;
    this.time = Math.min(1, Math.max(0, progress)) * this.duration;
    this.lastTimestamp = this.status === 'running' && this.initialized && !this.prepared.document.hidden ? this.prepared.window.performance.now() : undefined;
    if (this.initialized) {
      try { this.render(0, true); } catch (error) { this.fail(error); }
    } else this.pose = sample(this.time, this.trajectory);
  }
  setSpeed(speed: number) { finitePositive(speed, 'speed'); this.speed = speed; }
  on(type: PlaybackEventType, listener: PlaybackListener) {
    if (terminal(this.status)) return () => {};
    if (!(type in callbacks) || typeof listener !== 'function') throw new TypeError('Invalid playback subscription');
    const listeners = this.listeners.get(type) ?? new Set<PlaybackListener>();
    listeners.add(listener); this.listeners.set(type, listeners);
    return () => { listeners.delete(listener); };
  }
}

/** Owns every run, including queued runs, until it settles. */
export function createAnimator(defaults: MotionOptions): Animator {
  const runs = new Set<Playback>();
  const ownedRuns = new WeakMap<Playback, Playback>();
  let disposed = false;
  let epoch = 0;
  const own = (controller: Playback): Playback => {
    const existing = ownedRuns.get(controller);
    if (existing) return existing;
    const owned: Playback = {
      get status() { return controller.status; },
      get progress() { return controller.progress; },
      get currentTime() { return controller.currentTime; },
      get duration() { return controller.duration; },
      get finished() { return controller.finished; },
      pause: () => controller.pause(), resume: () => controller.resume(),
      cancel: reason => controller.cancel(reason), dispose: () => controller.dispose(),
      seek: progress => controller.seek(progress), setSpeed: speed => controller.setSpeed(speed),
      replay: () => {
        if (disposed) throw new Error('Animator has been disposed');
        const startedAt = epoch;
        const next = controller.replay();
        if (disposed || epoch !== startedAt) next.cancel(disposed ? 'disposed' : 'user');
        return own(next);
      },
      on: (type, listener) => controller.on(type, event => listener({ ...event, playback: own(event.playback) })),
    };
    ownedRuns.set(controller, owned);
    runs.add(owned);
    void controller.finished.then(() => runs.delete(owned));
    return owned;
  };
  return {
    play(overrides = {}) {
      if (disposed) throw new Error('Animator has been disposed');
      const startedAt = epoch;
      const options = { ...defaults, ...overrides };
      for (const name of Object.values(callbacks)) {
        const callback = options[name] as PlaybackListener | undefined;
        if (callback) Object.assign(options, { [name]: (event: Parameters<PlaybackListener>[0]) => callback({ ...event, playback: own(event.playback) }) });
      }
      const controller = play(options);
      if (disposed || epoch !== startedAt) controller.cancel(disposed ? 'disposed' : 'user');
      return own(controller);
    },
    cancel() { epoch++; for (const run of [...runs]) run.cancel(); },
    dispose() { disposed = true; epoch++; for (const run of [...runs]) run.dispose(); runs.clear(); },
  };
}

/** Explicit vanilla DOM opt-in. Framework users should render their own wrapper. */
export function wrap(element: HTMLElement): { element: HTMLElement; dispose(): void } {
  const parent = element.parentNode;
  if (!parent) throw new Error('wrap() requires an element with a parent');
  const wrapper = element.ownerDocument.createElement('div');
  const display = element.ownerDocument.defaultView?.getComputedStyle(element).display;
  wrapper.style.display = display === 'inline' || display === 'inline-block' ? 'inline-block' : 'block';
  wrapper.dataset.tflipWrapper = '';
  parent.insertBefore(wrapper, element); wrapper.append(element);
  let disposed = false;
  return { element: wrapper, dispose() {
    if (disposed) return;
    disposed = true;
    const lane = lanes.get(wrapper);
    for (const run of [lane?.active, ...(lane?.waiting ?? [])]) run?.dispose();
    if (element.parentNode === wrapper && wrapper.parentNode) wrapper.parentNode.replaceChild(element, wrapper);
    else wrapper.remove();
  } };
}
