#!/usr/bin/env node
// Smoke test for plugins/html-skills/assets/image-tools.js.
//
// Stubs just enough DOM (document.createElement, a window with
// addEventListener, a canvas 2d context) to mount ImageAnnotator and
// ImageCompareSlider under plain Node, then drives a rectangle, brush,
// and polygon session through the recorded pointer listeners and
// asserts the normalized export shape.
//
// Run: node scripts/smoke-image-tools.mjs   (no dependencies)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(root, '../plugins/html-skills/assets/image-tools.js'), 'utf8');

// ------------------------------------------------------------- DOM stubs

function makeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    style: { cssText: '' },
    children: [],
    listeners: {},
    attributes: {},
    parentNode: null,
    _text: '',
    set textContent(v) { this._text = String(v); },
    get textContent() { return this._text; },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i !== -1) this.children.splice(i, 1); c.parentNode = null; return c; },
    insertBefore(c, ref) { const i = ref ? this.children.indexOf(ref) : -1; c.parentNode = this; if (i === -1) this.children.push(c); else this.children.splice(i, 0, c); return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    setPointerCapture() {},
    releasePointerCapture() {},
    cloneNode() { return makeElement(tag); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; },
  };
  if (tag === 'canvas') {
    const ctx = new Proxy({}, {
      get: (t, k) => (k in t ? t[k] : () => {}),
      set: (t, k, v) => { t[k] = v; return true; },
    });
    el.getContext = () => ctx;
  }
  return el;
}

const container = makeElement('div');
const img = makeElement('img');
img.clientWidth = 800;
img.clientHeight = 600;
img.complete = true;
img.naturalWidth = 800;
container.appendChild(img);

// The asset only touches `window` and `document`, so a minimal sandbox
// context is enough to run it under plain Node.
const sandbox = {
  window: {
    addEventListener: () => {},
    removeEventListener: () => {},
    devicePixelRatio: 1,
    ResizeObserver: undefined,
  },
  document: { createElement: (t) => makeElement(t) },
};
vm.runInNewContext(src, sandbox, { filename: 'image-tools.js' });

const { ImageAnnotator, ImageCompareSlider } = sandbox.window;

// ------------------------------------------------------------- assertions

let passed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  passed++;
  console.log(`ok ${passed} — ${msg}`);
}
function near(a, b) { return Math.abs(a - b) < 1e-9; }

function fire(el, type, ev) {
  for (const fn of el.listeners[type] || []) fn(ev);
}
function pointer(x, y, extra = {}) {
  return {
    clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse',
    detail: 1, buttons: 1, preventDefault: () => {}, ...extra,
  };
}

// ------------------------------------------------------------- annotator

const ann = ImageAnnotator.mount(img, { tools: ['rect', 'brush', 'poly'] });
assert(ann && typeof ann.getAnnotations === 'function', 'ImageAnnotator.mount returns the api');
assert(ann.stage.children.length === 2, 'stage wraps the image + overlay canvas');
const canvas = ann.stage.children[1];
assert(canvas.tagName === 'CANVAS', 'overlay is a canvas');
assert(ann.toolbar.children.length >= 5, 'toolbar has tool + history buttons');

// Rectangle: (100,150) -> (300,270) on an 800x600 image.
ann.setTool('rect');
fire(canvas, 'pointerdown', pointer(100, 150));
fire(canvas, 'pointermove', pointer(300, 270));
fire(canvas, 'pointerup', pointer(300, 270));
let out = ann.getAnnotations();
assert(out.rectangles.length === 1, 'one rectangle after drag');
assert(
  near(out.rectangles[0].x, 0.125) && near(out.rectangles[0].y, 0.25) &&
  near(out.rectangles[0].w, 0.25) && near(out.rectangles[0].h, 0.2),
  'rectangle is normalized (100/800, 150/600, 200/800, 120/600)',
);

// Click with no drag must not commit.
fire(canvas, 'pointerdown', pointer(400, 300));
fire(canvas, 'pointerup', pointer(400, 300));
assert(ann.getAnnotations().rectangles.length === 1, 'zero-size drag is discarded');

// Brush: two points.
ann.setTool('brush');
fire(canvas, 'pointerdown', pointer(10, 10));
fire(canvas, 'pointermove', pointer(50, 20));
fire(canvas, 'pointerup', pointer(50, 20));
out = ann.getAnnotations();
assert(out.strokes.length === 1 && out.strokes[0].points.length === 2, 'brush stroke has two points');
assert(near(out.strokes[0].size, 0.008), 'brush keeps its normalized size');

// Polygon: three clicks + double-click to close.
ann.setTool('poly');
fire(canvas, 'pointerdown', pointer(0, 0));
fire(canvas, 'pointerdown', pointer(80, 0));
fire(canvas, 'pointerdown', pointer(80, 120));
fire(canvas, 'pointerdown', pointer(80, 120, { detail: 2 }));
out = ann.getAnnotations();
assert(out.polygons.length === 1 && out.polygons[0].length === 3, 'polygon closes with three vertices');
assert(near(out.polygons[0][1][0], 0.1) && near(out.polygons[0][2][1], 0.2), 'polygon vertices are normalized');

// Undo removes the polygon; redo restores it.
ann.undo();
assert(ann.getAnnotations().polygons.length === 0, 'undo removes the last shape');
ann.redo();
assert(ann.getAnnotations().polygons.length === 1, 'redo restores it');

// Select tool erases the topmost (the polygon).
// (60,60) -> (0.075, 0.1): strictly inside the triangle (x > 0.5y, x < 0.1).
ann.setTool('select');
fire(canvas, 'pointerdown', pointer(60, 60)); // inside the triangle
assert(ann.getAnnotations().polygons.length === 0, 'select-tool click erases the hit shape');

// ------------------------------------------------------------- slider

const box = makeElement('div');
const imgA = makeElement('img');
const imgB = makeElement('img');
const slider = ImageCompareSlider(box, { a: imgA, b: imgB, labelA: 'A', labelB: 'B', start: 0.25 });
assert(near(slider.getPos(), 0.25), 'slider starts where asked');
slider.setPos(0.7);
assert(near(slider.getPos(), 0.7), 'setPos updates the position');
const top = slider.stage.children[1];
const handle = slider.stage.children[4];
assert(top.style.clipPath === 'inset(0 30% 0 0)', 'top image is clipped to the left of the divider');
assert(handle.attributes['aria-valuenow'] === '70', 'handle exposes aria-valuenow');
assert(handle.attributes.role === 'slider', 'handle is a keyboard slider');
slider.setPos(1.5);
assert(near(slider.getPos(), 1), 'position is clamped to [0,1]');

console.log(`\n${passed} assertions passed — image-tools.js smoke test OK`);
