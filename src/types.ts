/** Pixels in viewport coordinates; y grows downwards. Durations are milliseconds. */
export interface Point { x: number; y: number; z?: number }
export type Axis = 'x' | 'y' | 'z';
export type Direction = 1 | -1;
export type Preset = 'launch' | 'gentle' | 'snappy' | 'float';
export type Phase = 'anticipation' | 'launch' | 'roll' | 'descent' | 'settle' | 'finished';
export interface PhaseRatios { anticipation: number; launch: number; roll: number; descent: number; settle: number }
export interface TrajectoryOptions {
  from?: Point; to?: Point; height?: number; turns?: number; direction?: Direction;
  axis?: Axis; duration?: number; preset?: Preset; bounce?: number; depth?: number;
  /** Intermediate absolute viewport points, excluding the endpoints. */
  path?: readonly Point[];
  pathMode?: 'linear' | 'smooth';
  phases?: Partial<PhaseRatios>;
}
export interface NormalizedTrajectory {
  from: Required<Point>; to: Required<Point>; height: number; turns: number; direction: Direction;
  axis: Axis; duration: number; preset: Preset; bounce: number; depth: number;
  path: readonly Required<Point>[]; pathMode: 'linear' | 'smooth'; phases: PhaseRatios;
}
/** Rotation angles are degrees, position is absolute viewport pixels. */
export interface Pose {
  x: number; y: number; z: number; rotateX: number; rotateY: number; rotateZ: number;
  scaleX: number; scaleY: number; progress: number; phase: Phase;
  thrust: number; shadowScale: number; shadowOpacity: number;
}
export type Anchor = Point | Element;
export type PlaybackStatus = 'queued' | 'running' | 'paused' | 'finished' | 'cancelled';
export type PlaybackEventType = 'start' | 'land' | 'finish' | 'cancel' | 'update';
export type CancelReason = 'user' | 'replaced' | 'disposed' | 'detached' | 'layout' | 'error' | string;
export type PlaybackResult = { status: 'finished' } | { status: 'cancelled'; reason: CancelReason; error?: unknown };
export interface PlaybackEvent {
  type: PlaybackEventType; playback: Playback; progress: number; pose: Pose; result?: PlaybackResult;
}
export type PlaybackListener = (event: PlaybackEvent) => void;
export interface Playback {
  readonly status: PlaybackStatus; readonly progress: number; readonly currentTime: number;
  readonly duration: number; readonly finished: Promise<PlaybackResult>;
  pause(): void; resume(): void; cancel(reason?: CancelReason): void;
  /** Starts a new playback with a fresh finished promise. */
  replay(): Playback;
  /** Clamped to 0..1. Seeking does not itself complete playback or emit land. */
  seek(progress: number): void;
  setSpeed(speed: number): void;
  on(type: PlaybackEventType, listener: PlaybackListener): () => void;
  dispose(): void;
}
export interface EffectContext { container: HTMLElement; document: Document; width: number; height: number }
export interface EffectFrame { pose: Pose; time: number; delta: number; duration: number; progress: number; reducedMotion: boolean; sample?: (timeMs: number) => Pose }
export interface MotionEffect { render(frame: EffectFrame): void; dispose(): void }
export type EffectFactory = (context: EffectContext) => MotionEffect;
export interface MotionOptions extends Omit<TrajectoryOptions, 'from' | 'to'> {
  from?: Anchor; to?: Anchor;
  /** Dedicated motion wrapper, never an arbitrary React child. No implicit reparenting. */
  element?: HTMLElement;
  mode?: 'in-place' | 'transfer';
  /** Factory must return a fresh detached, decorative HTMLElement. Not a live business node. */
  visual?: () => HTMLElement;
  size?: { width: number; height: number };
  speed?: number; autoplay?: boolean; repeat?: 'replace' | 'ignore' | 'queue';
  layout?: 'cancel' | 'freeze' | 'follow';
  reducedMotion?: 'system' | 'always' | 'never';
  perspective?: number; shadow?: boolean; backface?: 'visible' | 'hidden';
  effects?: EffectFactory | readonly EffectFactory[];
  signal?: AbortSignal;
  onStart?: PlaybackListener; onLand?: PlaybackListener; onFinish?: PlaybackListener;
  onCancel?: PlaybackListener; onUpdate?: PlaybackListener;
}
export interface Animator {
  play(overrides?: Partial<MotionOptions>): Playback;
  cancel(): void;
  dispose(): void;
}
export interface Sequence extends Omit<Playback, 'replay'> { replay(): Sequence }
