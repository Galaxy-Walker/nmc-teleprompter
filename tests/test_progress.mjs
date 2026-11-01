import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The browser uses native ES modules without a package.json or build step.
const source = await readFile(new URL("../web/progress.js", import.meta.url), "utf8");
const { renderProgress } = await import(`data:text/javascript,${encodeURIComponent(source)}`);

function tracked(property) {
  let value = "";
  return {
    writes: 0,
    get [property]() { return value; },
    set [property](next) { value = next; this.writes += 1; },
  };
}

function controls() {
  return [tracked("textContent"), tracked("value"), tracked("textContent")];
}

test("initial render, seek, rewind, completion and replay stay accurate", () => {
  const elements = controls();
  for (const [chars, expected] of [
    [0, ["0%", "0", "0% · 0/1000"]],
    [523.6, ["52%", "524", "52% · 524/1000"]],
    [120, ["12%", "120", "12% · 120/1000"]],
    [1000, ["100%", "1000", "100% · 1000/1000"]],
    [0, ["0%", "0", "0% · 0/1000"]],
  ]) {
    renderProgress(...elements, chars, 1000);
    assert.deepEqual([elements[0].textContent, elements[1].value, elements[2].textContent], expected);
  }
});

test("unchanged values do not write; external slider changes are reconciled", () => {
  const elements = controls();
  renderProgress(...elements, 100, 1000);
  renderProgress(...elements, 100.1, 1000);
  assert.deepEqual(elements.map(element => element.writes), [1, 1, 1]);
  elements[1].value = "900";
  renderProgress(...elements, 100.1, 1000);
  assert.equal(elements[1].value, "100");
  assert.deepEqual(elements.map(element => element.writes), [1, 3, 1]);
});

test("a reused view updates the total and handles zero units", () => {
  const elements = controls();
  renderProgress(...elements, 0, 1000);
  renderProgress(...elements, 0, 2000);
  assert.equal(elements[2].textContent, "0% · 0/2000");
  renderProgress(...elements, 0, 0);
  assert.equal(elements[2].textContent, "0% · 0/0");
  assert.equal(elements[1].value, "0");
});

for (const fps of [60, 120]) {
  test(`${fps} Hz playback preserves every displayed value with fewer writes`, t => {
    const elements = controls();
    const frames = fps * 60;
    for (let frame = 0; frame <= frames; frame += 1) {
      const chars = (220 / 60) * (frame / fps);
      renderProgress(...elements, chars, 10000);
      const ratio = chars / 10000;
      const percent = Math.round(ratio * 100);
      assert.equal(elements[0].textContent, `${percent}%`);
      assert.equal(elements[1].value, String(Math.round(ratio * 1000)));
      assert.equal(elements[2].textContent, `${percent}% · ${Math.round(chars)}/10000`);
    }
    const writes = elements.reduce((sum, element) => sum + element.writes, 0);
    const baseline = (frames + 1) * 3;
    assert.ok(writes < baseline * 0.05);
    t.diagnostic(`${baseline} -> ${writes} property writes over 60 seconds`);
  });
}
