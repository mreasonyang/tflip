function bindElement(name, selector, html = false) {
  const missing = JSON.stringify(`Tflip: missing required element ${selector}.`);
  const wrongType = JSON.stringify(`Tflip: ${selector} must be an HTMLElement.`);
  return `const ${name} = document.querySelector(${JSON.stringify(selector)});\nif (!${name}) throw new Error(${missing});${html ? `\nif (!(${name} instanceof HTMLElement)) throw new Error(${wrongType});` : ''}`;
}

/** Generate the same plain JavaScript for the preview and clipboard. */
export function createCodeExample({ mode, motion, anchors, size, effects }, t) {
  const transfer = mode === 'transfer';
  const points = anchors.kind === 'viewport';
  const useEffects = effects.jet || effects.trail;
  const imports = `import { play, sequence } from '@kyun.si/tflip/dom';${useEffects ? "\nimport { createParticles } from '@kyun.si/tflip/effects';" : ''}`;
  const bindings = transfer && !points
    ? `${bindElement('source', anchors.from)}\n${bindElement('target', anchors.to)}`
    : bindElement('wrapper', anchors.wrapper, true);
  const visual = transfer ? `\n\n// ${t('lab.code.freshVisual')}\nfunction createVisual() {\n  const card = document.createElement('div');\n  card.textContent = ${JSON.stringify(t('lab.code.visualText'))};\n  Object.assign(card.style, {\n    width: '176px', height: '116px', padding: '18px',\n    boxSizing: 'border-box', borderRadius: '12px',\n    background: '#ebe9ff', color: '#292354',\n    font: '14px system-ui', border: '1px solid #b7b1ff'\n  });\n  return card;\n}` : '';
  const identity = points ? `\n  // ${t('lab.code.identity')}\n  element: wrapper,` : '';
  const placement = transfer
    ? `\n  mode: 'transfer',${identity}\n  from: ${points ? JSON.stringify(anchors.from) : 'source'},\n  to: ${points ? JSON.stringify(anchors.to) : 'target'},\n  visual: createVisual,\n  size: ${JSON.stringify(size)},`
    : `\n  mode: 'in-place',\n  // ${t('lab.code.wrapper')}\n  element: wrapper,`;
  const config = JSON.stringify(motion, null, 2).replace(/^\{|\}$/g, '').trimEnd();
  const effectLine = useEffects ? `\n  effects: createParticles(${JSON.stringify(effects)}),` : '';
  // Object.freeze keeps literal option types in both .js and .ts consumers,
  // without TypeScript-only syntax or unchecked element assertions.
  return `${imports}\n\n${bindings}${visual}\n\nconst options = Object.freeze({${placement}${config},${effectLine}\n});\n\nconst playback = play(options);\nplayback.on('land', () => console.log(${JSON.stringify(t('lab.code.landed'))}));\n// playback.pause(); playback.resume(); playback.seek(0.5);\n// playback.setSpeed(0.35); playback.cancel();\n// const nextPlayback = playback.replay(); // ${t('lab.code.newPlayback')}\nconst result = await playback.finished;\nconsole.log(result.status); // ${t('lab.code.resultStates')}\n// ${t('lab.code.businessState')}${transfer ? `\n\n// ${t('lab.code.sequence')}\n// const journey = sequence([options, { ...options,\n//   from: options.to, to: options.from,\n//   direction: ${-motion.direction}, path: [...options.path].reverse()\n// }]);\n// journey.pause(); journey.resume(); journey.seek(0.75);` : ''}\n`;
}
