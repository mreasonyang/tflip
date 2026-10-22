import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { createCodeExample } from '../playground/code-example.js';
import translations from '../playground/locales/lab.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const translate = language => key => translations[language][key];
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function snapshot(kind, particles = 'off') {
  return {
    mode: kind === 'wrapper' ? 'in-place' : 'transfer',
    motion: {
      preset: 'launch', height: 160, duration: 1000, turns: 1,
      direction: kind === 'viewport' ? -1 : 1, axis: 'x', bounce: 0.14, depth: 40,
      path: [{ x: 240, y: 100, z: 12 }], pathMode: 'smooth',
      phases: { anticipation: 55, launch: 60, roll: 115, descent: 70, settle: 60 },
      speed: 1, perspective: 900, repeat: 'replace', layout: 'cancel',
      reducedMotion: 'system', shadow: true, backface: 'visible',
    },
    anchors: kind === 'selectors'
      ? { kind, from: '#source', to: '#target', wrapper: '[data-motion-wrapper]' }
      : kind === 'viewport'
        ? { kind, from: { x: 100, y: 80 }, to: { x: 500, y: 280 }, wrapper: '[data-motion-wrapper]' }
        : { kind, wrapper: '[data-motion-wrapper]' },
    size: { width: 176, height: 116 },
    effects: {
      jet: particles === 'both', trail: particles !== 'off', color: '#ffaf76',
      density: 1.2, intensity: 1.5, seed: 17,
      emitter: { offset: { x: 0, y: 64 }, direction: { x: 0, y: 1 } },
    },
  };
}

const variants = ['selectors', 'wrapper', 'viewport'].flatMap(kind =>
  ['off', 'trail', 'both'].map(particles => ({ name: `${kind}-${particles}`, value: snapshot(kind, particles) })));

async function consumer(t) {
  const directory = await mkdtemp(join(tmpdir(), 'tflip-copy-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'package.json'), '{"type":"module"}\n');
  await mkdir(join(directory, 'node_modules', '@tflip'), { recursive: true });
  await symlink(root, join(directory, 'node_modules', '@tflip', 'motion'), 'dir');
  return directory;
}

test('website-generated configurations typecheck unchanged as strict TypeScript and checked JavaScript', async t => {
  const directory = await consumer(t), files = [];
  for (const language of ['zh', 'en']) {
    for (const { name, value } of variants) {
      const code = createCodeExample(value, translate(language));
      for (const extension of ['ts', 'js']) {
        const filename = join(directory, `${language}-${name}-${extension}.${extension}`);
        await writeFile(filename, code);
        files.push(filename);
      }
      if (value.mode === 'transfer') {
        // Also validate the optional sequence exactly as offered for uncommenting.
        const sequence = code.replace(/^\/\/ (const journey|  from:|  direction:|\}\]\);|journey\.)/gm, '$1');
        const filename = join(directory, `${language}-${name}-sequence.ts`);
        await writeFile(filename, sequence);
        files.push(filename);
      }
    }
  }
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, noEmit: true,
    allowJs: true, checkJs: true, types: [], skipLibCheck: false,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => directory, getNewLine: () => '\n',
  }));
});

function environment(t, html = '<div id="source"><button>Source</button></div><div id="target"></div><div data-motion-wrapper><button>Content</button></div>') {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { pretendToBeVisual: true });
  const { window } = dom, { document } = window;
  const saved = new Map(['document', 'HTMLElement'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  globalThis.document = document;
  globalThis.HTMLElement = window.HTMLElement;
  t.after(() => {
    window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  let now = 0, identifier = 0, canvases = 0;
  const frames = new Map();
  Object.defineProperty(window.performance, 'now', { value: () => now });
  window.requestAnimationFrame = callback => { const id = ++identifier; frames.set(id, callback); return id; };
  window.cancelAnimationFrame = id => frames.delete(id);
  const media = new window.EventTarget(); media.matches = false;
  window.matchMedia = () => media;
  const context = {
    setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {},
    quadraticCurveTo() {}, closePath() {}, arc() {}, fill() {},
  };
  window.HTMLCanvasElement.prototype.getContext = () => { canvases++; return context; };
  for (const [index, element] of [...document.querySelectorAll('#source, #target, [data-motion-wrapper]')].entries()) {
    const x = 20 + index * 300, y = 60;
    element.getBoundingClientRect = () => ({ x, y, left: x, top: y, width: 176, height: 116, right: x + 176, bottom: y + 116 });
  }
  return {
    document, frames, get canvases() { return canvases; },
    async tick(delta) {
      now += delta;
      const callbacks = [...frames.values()]; frames.clear();
      for (const callback of callbacks) callback(now);
      await flush();
    },
  };
}

for (const { name, value } of variants) {
  test(`generated ${name} code executes as a JavaScript module and releases owned resources`, async t => {
    const directory = await consumer(t), env = environment(t);
    const wrapper = env.document.querySelector('[data-motion-wrapper]');
    const child = wrapper.firstElementChild;
    child.style.transform = 'rotate(12deg)';
    const source = env.document.querySelector('#source'), sourceParent = source.parentElement;
    const filename = join(directory, 'example.mjs');
    await writeFile(filename, `${createCodeExample(value, translate('en'))}\nexport { result };\n`);
    let importError;
    const loading = import(pathToFileURL(filename).href);
    void loading.catch(error => { importError = error; });
    const deadline = Date.now() + 3000;
    while (!env.frames.size && !importError && Date.now() < deadline) await new Promise(setImmediate);
    if (importError) throw importError;
    assert.ok(env.frames.size, 'The unmodified generated module must start playback');
    await env.tick(500);
    assert.equal(source.parentElement, sourceParent);
    assert.equal(child.style.transform, 'rotate(12deg)');
    if (value.mode === 'in-place') assert.notEqual(wrapper.style.transform, '');
    else assert.ok(env.document.querySelector('[data-tflip-overlay]'));
    assert.equal(env.canvases > 0, value.effects.jet || value.effects.trail);
    await env.tick(500);
    assert.deepEqual((await loading).result, { status: 'finished' });
    assert.equal(env.frames.size, 0);
    assert.equal(env.document.querySelector('[data-tflip-overlay], canvas'), null);
    assert.equal(wrapper.style.transform, '');
    assert.equal(child.style.transform, 'rotate(12deg)');
  });
}

for (const { name, kind, html, expected } of [
  { name: 'source', kind: 'selectors', html: '<div id="target"></div>', expected: 'Tflip: missing required element #source.' },
  { name: 'target', kind: 'selectors', html: '<div id="source"></div>', expected: 'Tflip: missing required element #target.' },
  { name: 'in-place wrapper', kind: 'wrapper', html: '', expected: 'Tflip: missing required element [data-motion-wrapper].' },
  { name: 'viewport owner', kind: 'viewport', html: '', expected: 'Tflip: missing required element [data-motion-wrapper].' },
  { name: 'non-HTML wrapper', kind: 'wrapper', html: '<svg data-motion-wrapper></svg>', expected: 'Tflip: [data-motion-wrapper] must be an HTMLElement.' },
]) {
  test(`generated code explains a missing or invalid ${name} before starting motion`, async t => {
    const directory = await consumer(t), env = environment(t, html);
    const filename = join(directory, 'missing.mjs');
    await writeFile(filename, createCodeExample(snapshot(kind, 'both'), translate('en')));
    await assert.rejects(import(pathToFileURL(filename).href), { message: expected });
    assert.equal(env.frames.size, 0);
    assert.equal(env.canvases, 0);
    assert.equal(env.document.querySelector('[data-tflip-overlay]'), null);
  });
}
