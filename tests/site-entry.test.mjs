import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createRootEntry } from '../scripts/site-entry.mjs';

const source = await readFile(new URL('../playground/index.html', import.meta.url), 'utf8');

for (const prefix of ['/', '/deep/site/']) {
  test(`root entry renders the full app and resolves resources under ${prefix}`, async () => {
    const html = createRootEntry(source);
    const dom = new JSDOM(html, { url: `https://site.invalid${prefix}` });
    try {
      const document = dom.window.document;
      assert.equal(document.querySelector('meta[http-equiv="refresh"]'), null);
      assert.ok(document.querySelector('#stunt'));
      assert.ok(document.querySelector('#lab'));
      assert.ok(document.querySelector('#agentEntryLink'));
      const resources = [...document.querySelectorAll('script[src], link[rel="stylesheet"]')];
      assert.ok(resources.length > 10);
      for (const element of resources) {
        const url = new URL(element.src || element.href);
        assert.equal(url.origin, 'https://site.invalid');
        assert.ok(url.pathname.startsWith(`${prefix}playground/`), url.href);
        const path = url.pathname.slice(prefix.length);
        assert.ok((await stat(new URL(`../${path}`, import.meta.url))).isFile(), url.href);
      }
      for (const anchor of document.querySelectorAll('a[href^="#"]')) {
        assert.equal(new URL(anchor.href).pathname, prefix, 'Section navigation stays in the root document');
      }
      assert.equal(new URL(document.querySelector('a[href="./"]').href).pathname, prefix);
      assert.equal(new URL(document.querySelector('#agentEntryLink').href).pathname, `${prefix}agent/index.md`);
      assert.ok(html.includes('data:image/svg+xml,'), 'Inline favicon remains intact');
    } finally { dom.window.close(); }
  });
}

test('the 404 response document renders independently at deep or prefixed paths', async () => {
  const html = await readFile(new URL('../404.html', import.meta.url), 'utf8');
  for (const path of ['/agent/downloads/missing.tgz', '/deep/site/agent/downloads/missing.tgz']) {
    const dom = new JSDOM(html, { url: `https://site.invalid${path}` });
    try {
      assert.match(dom.window.document.querySelector('h1').textContent, /404/);
      assert.equal(dom.window.document.querySelector('meta[http-equiv="refresh"]'), null);
      assert.equal(dom.window.document.querySelectorAll('script[src], link[rel="stylesheet"], img[src]').length, 0);
    } finally { dom.window.close(); }
  }
});
