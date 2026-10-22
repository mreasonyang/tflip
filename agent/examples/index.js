import { play } from '../runtime/dom/index.js';
import { mountGalleryDemo } from './gallery/index.js';
import { mountStunt } from './featured/index.js';
const host = document.querySelector('#example');
const status = document.querySelector('#status');
let scene;
let generation = 0;
function lab() {
  const wrapper = document.createElement('div');
  wrapper.dataset.labWrapper = '';
  wrapper.textContent = 'Your content';
  host.append(wrapper);
  let run;
  return {
    play() { run?.cancel('replaced'); run = play({ element: wrapper, preset: 'launch', height: 100, duration: 1800 }); return run; },
    pause() { run?.pause(); }, resume() { run?.resume(); }, cancel() { run?.cancel(); },
    seek(value) { if (!run || ['finished', 'cancelled'].includes(run.status)) this.play(); run.pause(); run.seek(value); },
    dispose() { run?.dispose(); wrapper.remove(); },
  };
}
function mount() {
  generation++;
  scene?.dispose();
  const id = document.querySelector('#demo').value;
  scene = id === 'lab' ? lab() : ['stunt', 'roadster', 'ramp'].includes(id) ? mountStunt(host) : mountGalleryDemo(host, id);
  status.textContent = 'Ready';
}
document.querySelector('#demo').addEventListener('change', mount);
document.querySelector('#play').addEventListener('click', () => {
  const token = ++generation;
  status.textContent = 'Playing';
  scene.play().finished.then(result => { if (token === generation) status.textContent = result.status; });
});
for (const action of ['pause', 'resume', 'cancel']) document.querySelector(`#${action}`).addEventListener('click', () => { scene[action](); status.textContent = action; });
document.querySelector('#seek').addEventListener('input', event => { scene.seek(Number(event.target.value)); });
window.addEventListener('pagehide', () => { generation++; scene?.dispose(); }, { once: true });
mount();
