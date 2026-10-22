import { fileURLToPath } from 'node:url';
import { syncStaticOutput } from './release-artifacts.mjs';

// Fixed, project-owned destination; no host configuration or publication.
const root = fileURLToPath(new URL('..', import.meta.url));
console.log(JSON.stringify(await syncStaticOutput(root)));
