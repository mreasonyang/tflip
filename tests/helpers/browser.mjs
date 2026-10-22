import { chromium, webkit } from 'playwright';
import { existsSync } from 'node:fs';

export function testEngines(legacyVariable) {
  const engines = (process.env.TFLIP_TEST_ENGINES || process.env[legacyVariable] || 'brave,webkit').split(',');
  if (!engines.length || engines.some(engine => !['brave', 'webkit'].includes(engine))) throw new Error('TFLIP_TEST_ENGINES must contain brave and/or webkit');
  return [...new Set(engines)];
}
export async function launchBrowser(engine) {
  if (engine === 'brave') {
    const candidates = process.env.BRAVE_EXECUTABLE ? [process.env.BRAVE_EXECUTABLE] : process.platform === 'darwin'
      ? ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser']
      : ['/usr/bin/brave-browser', '/usr/bin/brave-browser-stable', '/opt/brave.com/brave/brave'];
    const executablePath = candidates.find(path => existsSync(path));
    if (!executablePath) throw new Error('Brave is required; install it or set BRAVE_EXECUTABLE. No Chrome fallback is used.');
    return chromium.launch({ headless: true, executablePath });
  }
  if (engine === 'webkit') return webkit.launch({ headless: true, ...(process.env.WEBKIT_EXECUTABLE ? { executablePath: process.env.WEBKIT_EXECUTABLE } : {}) });
  throw new Error(`Unsupported browser: ${engine}`);
}
