import { createElement, forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { HTMLAttributes, RefObject } from 'react';
import { play as playDom } from '../dom/index.js';
import type { CancelReason, MotionOptions, Playback, PlaybackEvent, PlaybackListener } from '../types.js';

/** Use a dedicated wrapper so the child's own transform stays under React's control. */
export const Motion = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Motion(props, ref) {
  return createElement('div', { ...props, ref });
});
Motion.displayName = 'Motion';

/** The target element is supplied by the hook's ref and cannot be overridden. */
export type UseMotionOptions = Omit<MotionOptions, 'element'>;

export interface MotionControls {
  /** Returns immediately; playback.finished resolves with a finished/cancelled result. */
  play(overrides?: Partial<UseMotionOptions>): Playback;
  /** Cancels all controllers owned by this hook, including queued and replayed runs. */
  cancel(reason?: CancelReason): void;
  /** Last controller, for imperative access. Updating it does not rerender the component. */
  readonly playback: Readonly<RefObject<Playback | null>>;
}

/**
 * Call play from an event handler or an effect after the wrapper has mounted.
 * Defaults are read on each play; changing defaults does not mutate an active run.
 * Cleanup cancels all owned runs and suppresses their hook-managed callbacks.
 */
export function useMotion(
  ref: RefObject<HTMLElement | null>,
  defaultOptions: UseMotionOptions = {},
): MotionControls {
  const defaults = useRef(defaultOptions);
  const playback = useRef<Playback | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const active = useRef(new Set<Playback>());
  const wrappers = useRef(new WeakMap<Playback, Playback>());

  // Facades make replay part of the same owner, including replay called from an event.
  const own = useCallback(function track(controller: Playback, ownerGeneration = generation.current): Playback {
    const existing = wrappers.current.get(controller);
    if (existing) return existing;
    const withOwnedPlayback = (event: PlaybackEvent): PlaybackEvent => ({
      ...event,
      playback: track(event.playback, ownerGeneration),
    });
    const owned: Playback = {
      get status() { return controller.status; },
      get progress() { return controller.progress; },
      get currentTime() { return controller.currentTime; },
      get duration() { return controller.duration; },
      get finished() { return controller.finished; },
      pause: () => controller.pause(),
      resume: () => controller.resume(),
      cancel: (reason) => controller.cancel(reason),
      seek: (progress) => controller.seek(progress),
      setSpeed: (speed) => controller.setSpeed(speed),
      dispose: () => controller.dispose(),
      replay: () => {
        if (!mounted.current) throw new Error('Cannot replay motion after its React owner unmounted.');
        const requestedGeneration = generation.current;
        const next = track(controller.replay(), requestedGeneration);
        // Replacement callbacks can synchronously unmount or rebind the owner.
        if (!mounted.current || generation.current !== requestedGeneration) {
          next.cancel('disposed');
          return next;
        }
        playback.current = next;
        return next;
      },
      on: (type, listener) => controller.on(type, (event) => {
        if (mounted.current && generation.current === ownerGeneration) listener(withOwnedPlayback(event));
      }),
    };
    wrappers.current.set(controller, owned);
    active.current.add(owned);
    void controller.finished.then(() => { active.current.delete(owned); });
    return owned;
  }, []);

  const cancel = useCallback((reason: CancelReason = 'user') => {
    // Take a snapshot: cancellation callbacks may create a separate, new run.
    for (const controller of Array.from(active.current)) controller.cancel(reason);
  }, []);

  // In browsers, register before callers' layout effects. Server rendering never
  // runs effects and uses the passive variant to avoid React 18's SSR warning.
  const useLifecycleEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
  useLifecycleEffect(() => { defaults.current = defaultOptions; });
  useLifecycleEffect(() => {
    mounted.current = true;
    return () => {
      generation.current++;
      mounted.current = false;
      cancel('disposed');
      active.current.clear();
      playback.current = null;
    };
  }, [cancel, ref]);

  const play = useCallback((overrides: Partial<UseMotionOptions> = {}): Playback => {
    if (!mounted.current) throw new Error('Cannot play motion after its React owner unmounted.');
    if (!ref.current) throw new Error('useMotion requires a mounted element ref.');
    const requestedGeneration = generation.current;
    const options: MotionOptions = { ...defaults.current, ...overrides, element: ref.current };
    const wrapCallback = (listener: PlaybackListener | undefined): PlaybackListener | undefined =>
      listener && ((event) => {
        if (mounted.current && generation.current === requestedGeneration) {
          listener({ ...event, playback: own(event.playback, requestedGeneration) });
        }
      });
    options.onStart = wrapCallback(options.onStart);
    options.onLand = wrapCallback(options.onLand);
    options.onFinish = wrapCallback(options.onFinish);
    options.onCancel = wrapCallback(options.onCancel);
    options.onUpdate = wrapCallback(options.onUpdate);
    const next = own(playDom(options), requestedGeneration);
    if (!mounted.current || generation.current !== requestedGeneration) {
      next.cancel('disposed');
      return next;
    }
    playback.current = next;
    return next;
  }, [own, ref]);

  return useMemo(() => ({ play, cancel, playback }), [play, cancel]);
}

export type { MotionOptions, Playback, PlaybackResult } from '../types.js';
