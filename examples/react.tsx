import { useRef, useState } from 'react';
import { Motion, useMotion } from '@tflip/motion/react';

/** Import this component into an existing React 18/19 project. */
export function RollExample() {
  const wrapper = useRef<HTMLDivElement>(null);
  const destination = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Ready');
  const motion = useMotion(wrapper, {
    preset: 'launch',
    height: 150,
    duration: 1800,
    reducedMotion: 'system',
    onStart: () => setStatus('Animating'),
    onLand: () => setStatus('Landed'),
    onFinish: () => setStatus('Animation finished'),
    onCancel: () => setStatus('Animation cancelled'),
  });

  return (
    <section style={{ padding: 32, minHeight: 420, fontFamily: 'system-ui' }}>
      <h2>React roll animation</h2>
      <p>Animation lifecycle is separate from your application's task result.</p>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 150 }}>
        <Motion ref={wrapper} style={{ display: 'inline-block' }}>
          <div style={{ transform: 'rotate(-4deg)', padding: 24, borderRadius: 16, background: '#99f6e4', color: '#134e4a' }}>
            My React content
          </div>
        </Motion>
        <div ref={destination} style={{ border: '2px dashed #64748b', borderRadius: 16, padding: 24 }}>
          Visual destination
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 28 }}>
        <button onClick={() => motion.play()}>Roll in place</button>
        <button onClick={() => motion.play({
          mode: 'transfer',
          to: destination.current ?? undefined,
          // This temporary decorative node belongs to the animation, not React.
          // The live React content above keeps its parent, focus and event handlers.
          visual: () => {
            const visual = document.createElement('div');
            visual.textContent = 'Visual copy';
            visual.style.cssText = 'background:#99f6e4;color:#134e4a;border-radius:16px;padding:24px;box-sizing:border-box;';
            return visual;
          },
          size: { width: 160, height: 72 },
        })}>Fly a decorative visual</button>
        <button onClick={() => motion.playback.current?.pause()}>Pause</button>
        <button onClick={() => motion.playback.current?.resume()}>Resume</button>
        <button onClick={() => motion.playback.current?.seek(0.5)}>Seek 50%</button>
        <button onClick={() => motion.playback.current?.replay()}>Replay</button>
        <button onClick={() => motion.cancel()}>Cancel all</button>
      </div>
      <p role="status" aria-live="polite">{status}</p>
    </section>
  );
}
