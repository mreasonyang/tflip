import { getAgentLabConfig } from './app.js';
import { t, onLanguageChange } from './i18n.js';

const $ = id => document.getElementById(id);
const demoIds = ['lab', 'orbit', 'portal', 'vinyl', 'candy', 'arcade', 'paper', 'stunt'];
const frameworks = ['auto', 'vanilla', 'react'];
const catalogURL = new URL('../agent/catalog.json', import.meta.url);
let manifest;
let resources;
let lastPayload;
let loading = false;
let message = { key: 'agent.status.loading', params: {}, error: false };

class AgentConfigError extends Error {
  constructor(key) { super(key); this.messageDescriptor = { key, params: {} }; }
}

function phrase(descriptor) {
  const params = Object.fromEntries(Object.entries(descriptor.params || {}).map(([name, value]) => [
    name, value && typeof value === 'object' && typeof value.key === 'string' ? phrase(value) : value,
  ]));
  return t(descriptor.key, params);
}

function status(key, params = {}, error = false) {
  message = { key, params, error };
  $('agentStatus').textContent = phrase(message);
  $('agentStatus').dataset.error = String(error);
}

function invalid(error) {
  status('agent.status.invalid', { detail: error?.messageDescriptor || { key: 'agent.error.settings', params: {} } }, true);
}

function relativeURL(value) {
  if (typeof value !== 'string' || !value.trim() || /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(value) || value.includes('\\')) throw new AgentConfigError('agent.error.catalog');
  const url = new URL(value, catalogURL);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== catalogURL.origin) throw new AgentConfigError('agent.error.catalog');
  return url.href;
}

function artifact(value) {
  if (!value || !/^[a-f\d]{64}$/i.test(value.sha256) || !Number.isSafeInteger(value.bytes) || value.bytes <= 0) throw new AgentConfigError('agent.error.catalog');
  return relativeURL(value.url);
}

function validateManifest(value) {
  if (value?.schemaVersion !== 1 || typeof value.package?.name !== 'string' || typeof value.package?.version !== 'string' || !value.package.version.trim() || !Array.isArray(value.recipes)) throw new AgentConfigError('agent.error.catalog');
  const resolved = { entry: relativeURL(value.docs?.entry), skillDoc: relativeURL(value.docs?.skill), sdk: artifact(value.package), examples: artifact(value.downloads?.examples), skill: artifact(value.downloads?.skill), recipes: new Map() };
  for (const recipe of value.recipes) {
    if (!recipe || typeof recipe.id !== 'string' || !['sdk', 'composition', 'canvas-scene'].includes(recipe.kind) || resolved.recipes.has(recipe.id)) throw new AgentConfigError('agent.error.catalog');
    resolved.recipes.set(recipe.id, { kind: recipe.kind, url: relativeURL(recipe.recipe) });
  }
  if (demoIds.some(id => !resolved.recipes.has(id))) throw new AgentConfigError('agent.error.catalog');
  return resolved;
}

function selectionText() {
  const demo = $('agentDemo').value;
  const kind = resources?.recipes.get(demo)?.kind;
  $('agentKind').textContent = t(kind ? `agent.kind.${kind}` : 'agent.kind.loading');
  $('agentHelp').textContent = t(demo === 'lab' ? 'agent.help.lab' : `agent.help.${kind === 'canvas-scene' || demo === 'stunt' ? 'canvas-scene' : 'composition'}`);
  $('agentVersion').textContent = manifest ? t('agent.version', { version: manifest.package.version }) : '';
}

function updateLinks() {
  const links = { agentEntryLink: 'entry', agentSkillDocLink: 'skillDoc', agentSDKLink: 'sdk', agentExamplesLink: 'examples', agentSkillLink: 'skill' };
  for (const [id, key] of Object.entries(links)) {
    const link = $(id);
    link.href = resources[key];
    link.removeAttribute('aria-disabled');
    link.removeAttribute('tabindex');
  }
  $('agentCatalogLink').href = catalogURL.href;
}

async function loadManifest() {
  if (loading) return;
  loading = true;
  $('agentRetry').hidden = true;
  $('agentCopy').disabled = $('agentDownload').disabled = true;
  status('agent.status.loading');
  try {
    const response = await fetch(catalogURL, { cache: 'no-store' });
    if (!response.ok) throw new AgentConfigError('agent.error.catalog');
    const value = await response.json();
    const resolved = validateManifest(value);
    manifest = value; resources = resolved;
    updateLinks(); selectionText();
    $('agentCopy').disabled = $('agentDownload').disabled = false;
    status('agent.status.ready');
  } catch {
    manifest = resources = undefined;
    selectionText();
    $('agentRetry').hidden = false;
    status('agent.status.loadError', {}, true);
  } finally { loading = false; }
}

function snapshot() {
  if (!manifest || !resources) throw new AgentConfigError('agent.error.catalog');
  const demo = $('agentDemo').value, framework = $('agentFramework').value;
  if (!demoIds.includes(demo) || !frameworks.includes(framework)) throw new AgentConfigError('agent.error.selection');
  let config;
  if (demo === 'lab') config = getAgentLabConfig();
  else {
    const vehicle = demo === 'stunt';
    const checkbox = vehicle ? $(`${demo}Jet`) : document.querySelector(`[data-demo="${demo}"] [data-demo-jet]`);
    const speed = vehicle ? Number($(`${demo}Speed`).value) : 1;
    if (!checkbox || !Number.isFinite(speed) || speed <= 0) throw new AgentConfigError('agent.error.speed');
    config = { jet: checkbox.checked, speed };
  }
  return { schemaVersion: 1, sdkVersion: manifest.package.version, demo, framework, config };
}

function prompt(payload) {
  return t('agent.prompt', { version: payload.sdkVersion, revision: manifest.contentRevision || manifest.downloads.examples.sha256, entry: resources.entry, recipe: resources.recipes.get(payload.demo).url, json: JSON.stringify(payload, null, 2) });
}

function prepare() {
  const payload = snapshot();
  const text = prompt(payload);
  lastPayload = payload;
  $('agentPrompt').value = text;
  return { payload, text };
}

function manualCopy() {
  $('agentPreview').open = true;
  $('agentPrompt').focus({ preventScroll: true });
  $('agentPrompt').select();
  status('agent.status.manual');
}

$('agentCopy').addEventListener('click', async () => {
  let prepared;
  try { prepared = prepare(); } catch (error) { invalid(error); return; }
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(prepared.text);
    status('agent.status.copied');
  } catch { manualCopy(); }
});

$('agentDownload').addEventListener('click', () => {
  try {
    const { payload } = prepare();
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `tflip-${payload.demo}-config.json`;
    link.hidden = true; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('agent.status.downloaded');
  } catch (error) { invalid(error); }
});

$('agentPreview').querySelector('summary').addEventListener('click', event => {
  if ($('agentPreview').open) return;
  try { prepare(); status('agent.status.preview'); }
  catch (error) { event.preventDefault(); invalid(error); }
});

for (const id of ['agentDemo', 'agentFramework']) $(id).addEventListener('change', () => {
  lastPayload = undefined;
  $('agentPrompt').value = '';
  selectionText();
  if (!manifest) return;
  status('agent.status.ready');
  if ($('agentPreview').open) {
    try { prepare(); status('agent.status.preview'); } catch (error) { invalid(error); }
  }
});
$('agentRetry').addEventListener('click', loadManifest);

function entryText(button) {
  button.textContent = t('agent.entry');
  button.setAttribute('aria-label', t('agent.entry.a11y', { demo: t(`agent.demo.${button.dataset.agentDemo}`) }));
}

function addEntrypoints() {
  for (const demo of demoIds.filter(id => id !== 'lab')) {
    if (document.querySelector(`[data-agent-demo="${demo}"]`)) continue;
    const vehicle = demo === 'stunt';
    const parent = vehicle ? $(`${demo}HeroPlay`)?.closest('.roadster-source') : document.querySelector(`[data-demo="${demo}"] .demo-info`);
    if (!parent) continue;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'agent-scene-link'; button.dataset.agentDemo = demo;
    entryText(button);
    button.addEventListener('click', () => {
      $('agentDemo').value = demo;
      $('agentDemo').dispatchEvent(new Event('change', { bubbles: true }));
      $('agentIntegration').scrollIntoView({ behavior: 'instant', block: 'start' });
      $('agentDemo').focus({ preventScroll: true });
    });
    parent.append(button);
  }
}

onLanguageChange(() => {
  selectionText();
  status(message.key, message.params, message.error);
  for (const button of document.querySelectorAll('[data-agent-demo]')) entryText(button);
  if (lastPayload && resources) $('agentPrompt').value = prompt(lastPayload);
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addEntrypoints, { once: true });
else addEntrypoints();
selectionText();
void loadManifest();
