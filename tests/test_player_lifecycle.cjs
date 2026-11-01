const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const flush = () => new Promise(setImmediate);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Run the real router and player with controllable font/frame completion.
// These tests exercise lifecycle ordering, not browser layout or rendering.
function harness({ fonts = Promise.resolve() } = {}) {
  const targets = [];
  class Element {
    constructor() {
      targets.push(this);
      this.listeners = new Map();
      this.children = [];
      this.style = { setProperty() {} };
      this.dataset = {};
      this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
      this.offsetTop = 0;
      this.offsetHeight = 100;
    }
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(handler);
    }
    removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
    emit(type, event = {}) {
      for (const handler of this.listeners.get(type) || []) handler(event);
    }
    setAttribute() {}
    replaceChildren(...children) { this.children = children; }
  }
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id);
  };
  const frames = new Map();
  const timers = new Map();
  const wakes = [];
  let sequence = 0;
  const document = Object.assign(new Element(), {
    documentElement: new Element(), fonts: { ready: fonts },
    getElementById: node,
    querySelector: selector => node(selector.slice(1)),
    querySelectorAll: () => [],
    createElement: () => new Element(),
  });
  const window = Object.assign(new Element(), {
    setTimeout(handler) { timers.set(++sequence, handler); return sequence; },
    setInterval(handler) { timers.set(++sequence, handler); return sequence; },
  });
  const context = vm.createContext({
    document, window, Element, navigator: { userAgent: 'test' }, performance,
    location: { hash: '#/' },
    requestAnimationFrame(handler) { frames.set(++sequence, handler); return sequence; },
    cancelAnimationFrame(id) { frames.delete(id); },
    clearTimeout(id) { timers.delete(id); }, clearInterval(id) { timers.delete(id); },
    saveSettings() {}, applySettings() {}, loadSettings: () => ({}),
    initGuide() {}, initLibrary() {}, refreshLibrary: async () => {},
    getScript: async id => ({ title: id, paragraphs: [{ text: id, units: 10 }] }),
    createWakeLock() {
      const started = deferred();
      const wake = { started, destroys: 0, start: () => started.promise, stop() {},
        destroy() { this.destroys += 1; } };
      wakes.push(wake);
      return wake;
    },
  });
  for (const file of ['progress.js', 'player.js', 'app.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../web', file), 'utf8')
      .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
    vm.runInContext(source, context, { filename: file });
  }
  const listeners = () => targets.reduce((sum, target) => sum +
    [...target.listeners.values()].reduce((n, handlers) => n + handlers.size, 0), 0);
  const baselineListeners = listeners();
  async function frame() {
    const pending = [...frames.values()];
    frames.clear();
    for (const handler of pending) handler(16);
    await flush();
  }
  return { context, node, frames, timers, wakes, listeners, baselineListeners, frame };
}

test('switching A to B during the first frame preserves B and removes A listeners', async () => {
  const h = harness();
  const a = h.context.showPlayer('A');
  await flush();
  assert.equal(h.frames.size, 1);
  const playerListeners = h.listeners();
  const b = h.context.showPlayer('B');
  await flush();
  await a;
  assert.equal(h.wakes[0].destroys, 1);
  assert.equal(h.frames.size, 1);
  assert.equal(h.listeners(), playerListeners);
  await h.frame();
  await b;
  assert.equal(h.node('content').children[0].textContent, 'B');
  assert.equal(h.node('status').hidden, true);
  assert.equal(h.wakes[1].destroys, 0);
  await h.context.showLibrary();
  assert.equal(h.listeners(), h.baselineListeners);
  assert.equal(h.frames.size, 0);
});

test('returning to the library cancels font wait without waiting for fonts', async () => {
  const fonts = deferred();
  const h = harness({ fonts: fonts.promise });
  const pending = h.context.showPlayer('A');
  await flush();
  await h.context.showLibrary();
  await pending;
  assert.equal(h.listeners(), h.baselineListeners);
  assert.equal(h.node('content').children.length, 0);
  assert.equal(h.node('player-view').hidden, true);
  fonts.resolve();
  await flush();
  assert.equal(h.frames.size, 0);
  assert.equal(h.node('content').children.length, 0);
});

test('returning to library cancels pending initialization frame', async () => {
  const h = harness();
  const pending = h.context.showPlayer('A');
  await flush();
  await h.context.showLibrary();
  await pending;
  assert.equal(h.frames.size, 0);
  assert.equal(h.listeners(), h.baselineListeners);
  assert.equal(h.wakes[0].destroys, 1);
});

test('double destroy cannot clear a newer player; late wake result cannot change its UI', async () => {
  const h = harness();
  const script = title => ({ title, paragraphs: [{ text: title, units: 10 }] });
  const a = h.context.createPlayer({ script: script('A'), settings: {} });
  await flush(); await h.frame(); await a.ready;
  h.node('start-btn').emit('click'); // Leave a wake.start() result pending.
  a.destroy();
  const b = h.context.createPlayer({ script: script('B'), settings: {} });
  a.destroy();
  h.wakes[0].started.resolve(false);
  await flush(); await h.frame(); await b.ready;
  assert.equal(h.node('content').children[0].textContent, 'B');
  assert.equal(h.node('wake-note').hidden, true);
  assert.equal(h.wakes[0].destroys, 1);
  assert.equal(h.timers.size, 0);
  b.destroy();
  assert.equal(h.listeners(), h.baselineListeners);
});

test('initialization failure releases resources and displays the router error', async () => {
  const fonts = deferred();
  const h = harness({ fonts: fonts.promise });
  const pending = h.context.showPlayer('A');
  await flush();
  fonts.reject(new Error('font failure'));
  await pending;
  assert.match(h.node('status').textContent, /加载失败：font failure/);
  assert.equal(h.listeners(), h.baselineListeners);
  assert.equal(h.frames.size, 0);
  assert.equal(h.wakes[0].destroys, 1);
});
