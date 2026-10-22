import ui from './static.js';
import lab from './lab.js';
import showcase from './showcase.js';
import featured from './featured.js';
import agent from './agent.js';

export default {
  zh: { ...ui.zh, ...lab.zh, ...showcase.zh, ...featured.zh, ...agent.zh },
  en: { ...ui.en, ...lab.en, ...showcase.en, ...featured.en, ...agent.en },
};
