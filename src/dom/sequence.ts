import { normalizeOptions, sample } from '../core/index.js';
import { play } from './index.js';
import type { CancelReason, MotionOptions, Playback, PlaybackEvent, PlaybackEventType, PlaybackListener, PlaybackResult, PlaybackStatus, Pose, Sequence } from '../types.js';

const terminal = (status: PlaybackStatus) => status === 'finished' || status === 'cancelled';
const callbackNames = { start: 'onStart', land: 'onLand', finish: 'onFinish', cancel: 'onCancel', update: 'onUpdate' } as const;

/**
 * Sequential motion in nominal trajectory milliseconds. seek() selects an absolute
 * position in that aggregate timeline, recreating the selected step's visual.
 * Skipped steps do not fire lifecycle callbacks; seeking never completes a run.
 * A step's speed changes wall-clock playback, not its share of the timeline.
 * repeat:'ignore' joins an existing run at its current position; it never resets
 * that run implicitly. Sequence controls then control the joined playback too.
 */
export function sequence(steps: readonly MotionOptions[]): Sequence {
  return new MotionSequence(steps);
}

class MotionSequence implements Sequence {
  private readonly steps: readonly MotionOptions[];
  private readonly durations: number[];
  private readonly offsets: number[];
  private _status: PlaybackStatus = 'queued';
  private index = 0;
  private child?: Playback;
  private generation = 0;
  private started = false;
  private cancelling = false;
  private wantsRun: boolean;
  private speed = 1;
  private savedTime = 0;
  private pose: Pose;
  private listeners = new Map<PlaybackEventType, Set<PlaybackListener>>();
  private dispatching = new Set<PlaybackEventType>();
  private resolve!: (result: PlaybackResult) => void;
  readonly finished: Promise<PlaybackResult>;
  private totalDuration: number;

  constructor(steps: readonly MotionOptions[]) {
    if (!Array.isArray(steps)) throw new TypeError('sequence() requires an array of motion options');
    this.steps = steps.map(step => ({ ...step }));
    this.durations = this.steps.map(step => {
      if (!Number.isFinite(step.speed ?? 1) || (step.speed ?? 1) <= 0) throw new RangeError('speed must be finite and greater than zero');
      // DOM anchors are resolved at each step's activation; trajectory validation is immediate.
      return normalizeOptions({ ...step, from: { x: 0, y: 0 }, to: { x: 0, y: 0 } }).duration;
    });
    let sum = 0;
    this.offsets = this.durations.map(duration => { const offset = sum; sum += duration; return offset; });
    this.totalDuration = sum;
    this.wantsRun = this.steps[0]?.autoplay !== false;
    this.pose = sample(0, { duration: sum || 1 });
    this.finished = new Promise(resolve => { this.resolve = resolve; });
    // Calling play here preserves synchronous setup validation for the first step.
    if (this.steps.length) this.createChild(0, 0);
    queueMicrotask(() => {
      if (terminal(this.status)) return;
      this._status = this.wantsRun ? 'running' : 'paused';
      if (this.wantsRun) {
        if (this.child) { if (this.child.status === 'running') this.emitStart(); this.child.resume(); }
        else { this.emitStart(); this.settle({ status: 'finished' }); }
      }
    });
  }
  get status(): PlaybackStatus {
    if (terminal(this._status)) return this._status;
    if (this.child?.status === 'queued' && this._status !== 'paused') return 'queued';
    return this._status;
  }
  get duration() { return this.totalDuration; }
  get currentTime() { return terminal(this._status) ? this.savedTime : (this.offsets[this.index] ?? 0) + (this.child?.currentTime ?? 0); }
  get progress() { return this.duration ? Math.min(1, this.currentTime / this.duration) : this._status === 'finished' ? 1 : 0; }

  private createChild(index: number, localProgress: number) {
    if (terminal(this._status) || this.cancelling) return;
    this.index = index;
    const generation = ++this.generation;
    const step = this.steps[index];
    const overrides: Partial<MotionOptions> = {};
    for (const [type, name] of Object.entries(callbackNames) as [PlaybackEventType, typeof callbackNames[PlaybackEventType]][]) {
      overrides[name] = event => {
        if (generation !== this.generation || terminal(this._status)) return;
        step[name]?.(event);
      };
    }
    const child = play({ ...step, ...overrides, autoplay: false, speed: (step.speed ?? 1) * this.speed });
    if (generation !== this.generation || terminal(this._status) || this.cancelling) {
      child.cancel(this.status === 'cancelled' ? 'sequence-cancelled' : 'sequence-replaced');
      return;
    }
    this.child = child;
    // An ignored call returns the existing controller, whose original duration
    // wins over the ignored options. Aggregate time must reflect that real run.
    if (this.durations[index] !== child.duration) {
      this.durations[index] = child.duration;
      let offset = 0;
      for (let i = 0; i < this.durations.length; i++) { this.offsets[i] = offset; offset += this.durations[i]; }
      this.totalDuration = offset;
    }
    child.on('start', event => { if (this.owns(child, generation)) { this.pose = event.pose; this.emitStart(); } });
    child.on('update', event => { if (this.owns(child, generation)) { this.pose = event.pose; this.emit('update'); } });
    child.on('land', event => { if (this.owns(child, generation)) { this.pose = event.pose; this.emit('land'); } });
    void child.finished.then(result => {
      if (!this.owns(child, generation)) return;
      if (result.status === 'cancelled') { this.settle(result); return; }
      if (index + 1 >= this.steps.length) { this.settle({ status: 'finished' }); return; }
      try {
        this.createChild(index + 1, 0);
        if (this.wantsRun && !terminal(this._status)) this.child!.resume();
      } catch (error) { this.settle({ status: 'cancelled', reason: 'error', error }); }
    });
    // Initial position zero is already the default for new runs. Omitting that
    // seek also preserves an externally active run returned by repeat:'ignore'.
    if (localProgress !== 0) child.seek(localProgress);
    if (this.owns(child, generation) && !this.wantsRun) child.pause();
  }
  private owns(child: Playback, generation: number) { return this.child === child && this.generation === generation && !terminal(this._status); }
  private emitStart() { if (!this.started) { this.started = true; this.emit('start'); } }
  private emit(type: PlaybackEventType, result?: PlaybackResult) {
    if (this.dispatching.has(type)) return;
    this.dispatching.add(type);
    const event: PlaybackEvent = { type, playback: this, pose: this.pose, progress: this.progress, result };
    try {
      for (const listener of [...(this.listeners.get(type) ?? [])]) {
        if (terminal(this._status) && type !== 'cancel' && type !== 'finish') break;
        listener(event);
      }
    } catch (error) {
      if (!terminal(this._status)) {
        this.generation++;
        this.child?.cancel('error');
        this.settle({ status: 'cancelled', reason: 'error', error });
      }
    } finally { this.dispatching.delete(type); }
  }
  private settle(result: PlaybackResult) {
    if (terminal(this._status)) return;
    this.savedTime = result.status === 'finished' ? this.duration : this.currentTime;
    this._status = result.status;
    this.resolve(result);
    this.emit(result.status === 'finished' ? 'finish' : 'cancel', result);
    this.listeners.clear();
  }
  pause() {
    if (terminal(this._status) || this.cancelling) return;
    this.wantsRun = false; this._status = 'paused'; this.child?.pause();
  }
  resume() {
    if (terminal(this._status) || this.cancelling) return;
    this.wantsRun = true; this._status = 'running';
    if (this.child) this.child.resume();
    else { this.emitStart(); this.settle({ status: 'finished' }); }
  }
  cancel(reason: CancelReason = 'user') {
    if (terminal(this._status) || this.cancelling) return;
    this.cancelling = true;
    this.child?.cancel(reason);
    this.generation++;
    this.settle({ status: 'cancelled', reason });
  }
  dispose() { this.cancel('disposed'); }
  replay(): Sequence { return sequence(this.steps.map((step, index) => ({ ...step, repeat: 'replace', ...(index === 0 ? { autoplay: true } : {}) }))); }
  seek(progress: number) {
    if (!Number.isFinite(progress)) throw new RangeError('progress must be finite');
    if (terminal(this._status) || this.cancelling || !this.steps.length) return;
    const target = Math.max(0, Math.min(1, progress)) * this.duration;
    let index = this.durations.length - 1;
    for (let i = 0; i < this.durations.length; i++) {
      if (target < this.offsets[i] + this.durations[i]) { index = i; break; }
    }
    const local = this.durations[index] ? (target - this.offsets[index]) / this.durations[index] : 1;
    if (index === this.index && this.child && !terminal(this.child.status)) { this.child.seek(local); return; }
    this.generation++;
    this.child?.cancel('sequence-seek');
    try {
      this.createChild(index, local);
      if (this.wantsRun && !terminal(this._status)) this.child!.resume();
    } catch (error) { this.settle({ status: 'cancelled', reason: 'error', error }); }
  }
  setSpeed(speed: number) {
    if (!Number.isFinite(speed) || speed <= 0) throw new RangeError('speed must be finite and greater than zero');
    this.speed = speed;
    this.child?.setSpeed((this.steps[this.index]?.speed ?? 1) * speed);
  }
  on(type: PlaybackEventType, listener: PlaybackListener) {
    if (terminal(this._status)) return () => {};
    if (!(type in callbackNames) || typeof listener !== 'function') throw new TypeError('Invalid sequence subscription');
    const listeners = this.listeners.get(type) ?? new Set<PlaybackListener>();
    listeners.add(listener); this.listeners.set(type, listeners);
    return () => { listeners.delete(listener); };
  }
}
