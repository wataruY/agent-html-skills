// Image tools for html-skills artifacts — zero-dependency, file://-safe.
//
// Two factories on window:
//
//   ImageAnnotator.mount(img, opts)
//     Wraps an <img> in a relative stage, overlays a canvas, and adds a
//     toolbar (select/erase, rectangle, freehand brush, polygon, undo,
//     redo, clear). Annotations are stored NORMALIZED (0..1 against the
//     image box) and exported via ann.getAnnotations(), so the payload is
//     independent of the display size:
//       {
//         rectangles: [{ x, y, w, h }],
//         strokes:    [{ size, points: [[x, y], …] }],
//         polygons:   [[[x, y], …]],
//       }
//     opts: { tools: ['rect','brush','poly'], brushSize: 0.008, onChange: fn }
//       tools — which drawing tools to show ('select' is always kept, it is
//               the erase tool: click an annotation to remove it).
//     Returns { getAnnotations, setTool, undo, redo, clear, destroy,
//               stage, toolbar }.
//
//   ImageCompareSlider(container, opts)
//     Stacks two images with a draggable, keyboard-navigable divider
//     (A visible left of the divider, B right). Both images should share
//     an aspect ratio; the top image is cloned so the caller's elements
//     stay untouched.
//     opts: { a: imgEl, b: imgEl, labelA: 'A', labelB: 'B', start: 0.5 }
//     Returns { getPos, setPos, destroy, stage }.
//
// No network, no eval, no external assets. Inline it next to
// submit-handler.js in a single-file artifact. Data-URI and local
// (same-folder) images do not taint the canvas, so canvas export keeps
// working; a cross-origin <img> would taint it.

(function () {
  'use strict';

  // ------------------------------------------------------------- helpers

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  function round4(v) { return Math.round(v * 10000) / 10000; }

  function pointInRect(p, r) {
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  }

  function pointInPolygon(p, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var a = pts[i], b = pts[j];
      if ((a.y > p.y) !== (b.y > p.y) &&
          p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
    return inside;
  }

  function distToSegment(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len2 = dx * dx + dy * dy;
    var t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    t = clamp01(t);
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function nearStroke(p, pts, tol) {
    for (var i = 1; i < pts.length; i++) {
      if (distToSegment(p, pts[i - 1], pts[i]) < tol) return true;
    }
    return false;
  }

  var LIVE = []; // live annotators, for the multi-instance key guard

  // ---------------------------------------------------- ImageAnnotator

  function mount(img, opts) {
    opts = opts || {};
    var wantTools = (opts.tools && opts.tools.length) ? opts.tools : ['rect', 'brush', 'poly'];
    var tools = wantTools.slice();
    if (tools.indexOf('select') === -1) tools.unshift('select');

    var state = {
      tool: 'select',
      rects: [],     // { x, y, w, h }
      strokes: [],   // { points: [{x,y}, …], size }
      polys: [],     // [{x,y}, …]
      draft: null,   // in-progress shape
      brush: opts.brushSize || 0.008,
      history: [],
      future: [],
      hover: false,
    };

    // Stage: relative wrapper around the image + absolute canvas overlay.
    // Capture the parent BEFORE moving the image — img.parentNode becomes
    // the stage itself once the image is wrapped.
    var parent = img.parentNode;
    var stage = document.createElement('div');
    stage.style.cssText = 'position:relative;display:inline-block;max-width:100%;line-height:0;';
    parent.insertBefore(stage, img);
    stage.appendChild(img);
    img.style.display = 'block';
    img.style.maxWidth = '100%';

    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;touch-action:none;cursor:default;';
    stage.appendChild(canvas);
    var ctx = canvas.getContext('2d');

    // -------------------------------------------------------- toolbar

    var ACCENT = '#4f8cff';
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 8px;font:13px/1.4 system-ui,sans-serif;';
    parent.insertBefore(bar, stage);

    function button(label, title, key) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title + (key ? ' (' + key + ')' : '');
      b.style.cssText = 'padding:4px 10px;border:1px solid #b8c2d4;border-radius:6px;background:#fff;cursor:pointer;font:inherit;color:#1c2733;';
      b.addEventListener('click', function () { b.focus(); b._fire(); });
      b._fire = function () {};
      bar.appendChild(b);
      return b;
    }

    var toolButtons = {};
    tools.forEach(function (t) {
      var label = { select: 'Select / erase', rect: 'Rectangle', brush: 'Brush', poly: 'Polygon' }[t];
      var key = { select: '4', rect: '1', brush: '2', poly: '3' }[t];
      toolButtons[t] = button(label, 'Tool: ' + label, key);
      toolButtons[t]._fire = function () { setTool(t); };
    });

    var sizeWrap = document.createElement('span');
    sizeWrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;';
    sizeWrap.textContent = 'Brush size ';
    var sizeInput = document.createElement('input');
    sizeInput.type = 'range';
    sizeInput.min = '0.002'; sizeInput.max = '0.04'; sizeInput.step = '0.001';
    sizeInput.value = String(state.brush);
    sizeInput.setAttribute('aria-label', 'Brush size');
    sizeWrap.appendChild(sizeInput);
    bar.appendChild(sizeWrap);
    sizeInput.addEventListener('input', function () { state.brush = Number(sizeInput.value); });

    function spacer() { var s = document.createElement('span'); s.style.cssText = 'width:2px;height:20px;background:#d5dce8;'; bar.appendChild(s); }
    spacer();

    var undoBtn = button('Undo', 'Undo (Ctrl/Cmd+Z)');
    var redoBtn = button('Redo', 'Redo (Ctrl/Cmd+Shift+Z)');
    var clearBtn = button('Clear', 'Clear all annotations');
    undoBtn._fire = undo;
    redoBtn._fire = redo;
    clearBtn._fire = clear;

    // -------------------------------------------------------- geometry

    function fit() {
      var w = img.clientWidth, h = img.clientHeight;
      var dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    }
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(fit);
      ro.observe(img);
    }
    window.addEventListener('resize', fit);
    if (img.complete && img.naturalWidth) fit();
    img.addEventListener('load', fit);

    function toNorm(e) {
      var r = canvas.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return { x: 0, y: 0 };
      return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
    }

    // -------------------------------------------------------- history

    function snapshot() {
      return JSON.parse(JSON.stringify({ rects: state.rects, strokes: state.strokes, polys: state.polys }));
    }
    function pushHistory() {
      state.history.push(snapshot());
      if (state.history.length > 100) state.history.shift();
      state.future.length = 0;
    }
    function restore(snap) {
      state.rects = snap.rects; state.strokes = snap.strokes; state.polys = snap.polys;
      state.draft = null;
      draw();
      if (opts.onChange) opts.onChange(getAnnotations());
    }
    function undo() {
      if (!state.history.length) return;
      state.future.push(snapshot());
      restore(state.history.pop());
    }
    function redo() {
      if (!state.future.length) return;
      state.history.push(snapshot());
      restore(state.future.pop());
    }
    function clear() {
      if (!state.rects.length && !state.strokes.length && !state.polys.length) return;
      pushHistory();
      state.rects.length = 0; state.strokes.length = 0; state.polys.length = 0;
      state.draft = null;
      draw();
      if (opts.onChange) opts.onChange(getAnnotations());
    }

    // -------------------------------------------------------- drawing

    function strokePath(pts, w, h) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x * w, pts[0].y * h);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * w, pts[i].y * h);
    }

    function draw() {
      var w = img.clientWidth, h = img.clientHeight;
      ctx.clearRect(0, 0, w, h);
      if (!w || !h) return;

      // Freehand strokes.
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = ACCENT;
      state.strokes.forEach(function (s) {
        ctx.lineWidth = Math.max(1, s.size * w);
        if (s.points.length < 2) {
          ctx.beginPath();
          ctx.arc(s.points[0].x * w, s.points[0].y * h, Math.max(1, s.size * w) / 2, 0, Math.PI * 2);
          ctx.fillStyle = ACCENT;
          ctx.fill();
          return;
        }
        strokePath(s.points, w, h);
        ctx.stroke();
      });

      // Rectangles.
      state.rects.forEach(function (r) {
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = ACCENT;
        ctx.fillRect(r.x * w, r.y * h, r.w * w, r.h * h);
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.strokeRect(r.x * w, r.y * h, r.w * w, r.h * h);
      });

      // Polygons.
      state.polys.forEach(function (p) {
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = ACCENT;
        strokePath(p, w, h);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = ACCENT;
        p.forEach(function (pt) {
          ctx.beginPath();
          ctx.arc(pt.x * w, pt.y * h, 3, 0, Math.PI * 2);
          ctx.fill();
        });
      });

      // Draft (in-progress shape).
      if (state.draft) {
        var d = state.draft;
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = ACCENT;
        if (d.type === 'rect') {
          ctx.strokeRect(d.x * w, d.y * h, d.w * w, d.h * h);
        } else if (d.type === 'stroke') {
          if (d.points.length > 1) { strokePath(d.points, w, h); ctx.stroke(); }
        } else if (d.type === 'poly' && d.points.length) {
          strokePath(d.points, w, h);
          if (d.cursor) ctx.lineTo(d.cursor.x * w, d.cursor.y * h);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }

    // -------------------------------------------------------- pointer

    var pointer = { active: false, start: null, poly: [] };

    function commitPoly() {
      if (pointer.poly.length < 3) return;
      pushHistory();
      state.polys.push(pointer.poly.slice());
      pointer.poly = [];
      state.draft = null;
      draw();
      if (opts.onChange) opts.onChange(getAnnotations());
    }

    canvas.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      var p = toNorm(e);

      if (state.tool === 'select') {
        // Erase topmost hit. Tolerance scales with the image box.
        var tol = 8 / Math.max(1, canvas.getBoundingClientRect().width);
        var i;
        for (i = state.polys.length - 1; i >= 0; i--) {
          if (pointInPolygon(p, state.polys[i]) || nearStroke(p, state.polys[i], tol)) {
            pushHistory(); state.polys.splice(i, 1); draw();
            if (opts.onChange) opts.onChange(getAnnotations());
            return;
          }
        }
        for (i = state.strokes.length - 1; i >= 0; i--) {
          if (nearStroke(p, state.strokes[i].points, tol + state.strokes[i].size)) {
            pushHistory(); state.strokes.splice(i, 1); draw();
            if (opts.onChange) opts.onChange(getAnnotations());
            return;
          }
        }
        for (i = state.rects.length - 1; i >= 0; i--) {
          if (pointInRect(p, state.rects[i])) {
            pushHistory(); state.rects.splice(i, 1); draw();
            if (opts.onChange) opts.onChange(getAnnotations());
            return;
          }
        }
        return;
      }

      if (state.tool === 'rect') {
        pointer.active = true;
        pointer.start = p;
        state.draft = { type: 'rect', x: p.x, y: p.y, w: 0, h: 0 };
      } else if (state.tool === 'brush') {
        pointer.active = true;
        state.draft = { type: 'stroke', points: [p], size: state.brush };
      } else if (state.tool === 'poly') {
        if (e.detail === 2) { commitPoly(); return; } // double-click closes
        var last = pointer.poly[pointer.poly.length - 1];
        if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.004) { draw(); return; }
        pointer.poly.push(p);
        state.draft = { type: 'poly', points: pointer.poly.slice() };
      }
      draw();
    });

    canvas.addEventListener('pointermove', function (e) {
      var p = toNorm(e);
      if (state.draft && state.draft.type === 'poly') state.draft.cursor = p;
      if (!pointer.active || !state.draft) { draw(); return; }
      if (state.draft.type === 'rect') {
        var d = state.draft;
        d.x = Math.min(p.x, pointer.start.x);
        d.y = Math.min(p.y, pointer.start.y);
        d.w = Math.abs(p.x - pointer.start.x);
        d.h = Math.abs(p.y - pointer.start.y);
      } else if (state.draft.type === 'stroke') {
        var pts = state.draft.points;
        var q = pts[pts.length - 1];
        var r = canvas.getBoundingClientRect();
        if (r.width > 1 && Math.hypot((p.x - q.x) * r.width, (p.y - q.y) * r.height) > 2) {
          pts.push(p);
        }
      }
      draw();
    });

    function endPointer() {
      if (!pointer.active || !state.draft) return;
      pointer.active = false;
      var d = state.draft;
      if (d.type === 'rect') {
        if (d.w < 0.005 || d.h < 0.005) { state.draft = null; draw(); return; } // treat as a click
        pushHistory();
        state.rects.push({ x: d.x, y: d.y, w: d.w, h: d.h });
      } else if (d.type === 'stroke') {
        pushHistory();
        state.strokes.push({ points: d.points, size: d.size });
      }
      state.draft = null;
      draw();
      if (opts.onChange) opts.onChange(getAnnotations());
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

    // -------------------------------------------------------- keyboard

    function keyActive() { return LIVE.length === 1 || state.hover; }

    stage.addEventListener('pointerenter', function () { state.hover = true; });
    stage.addEventListener('pointerleave', function () { state.hover = false; });

    function onKey(e) {
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (!keyActive()) return;
      var k = e.key;
      if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (k === '1') setTool('rect');
      else if (k === '2') setTool('brush');
      else if (k === '3') setTool('poly');
      else if (k === '4' || k.toLowerCase() === 'v') setTool('select');
      else if (k === 'Escape' && state.draft && state.draft.type === 'poly') {
        pointer.poly = []; state.draft = null; draw();
      } else if (k === 'Enter' && state.draft && state.draft.type === 'poly') commitPoly();
    }
    window.addEventListener('keydown', onKey);

    function setTool(t) {
      if (tools.indexOf(t) === -1) return;
      state.tool = t;
      tools.forEach(function (tt) {
        toolButtons[tt].setAttribute('aria-pressed', String(tt === t));
        toolButtons[tt].style.outline = tt === t ? '2px solid ' + ACCENT : 'none';
      });
      canvas.style.cursor = t === 'select' ? 'default' : 'crosshair';
      sizeWrap.style.visibility = tools.indexOf('brush') === -1 ? 'hidden' : 'visible';
      if (state.draft && state.draft.type !== t && (t !== 'poly' || state.draft.type !== 'poly')) {
        state.draft = null; pointer.poly = []; draw();
      }
    }
    setTool('select');

    // -------------------------------------------------------- public

    function getAnnotations() {
      return {
        rectangles: state.rects.map(function (r) {
          return { x: round4(r.x), y: round4(r.y), w: round4(r.w), h: round4(r.h) };
        }),
        strokes: state.strokes.map(function (s) {
          return {
            size: round4(s.size),
            points: s.points.map(function (p) { return [round4(p.x), round4(p.y)]; }),
          };
        }),
        polygons: state.polys.map(function (p) {
          return p.map(function (pt) { return [round4(pt.x), round4(pt.y)]; });
        }),
      };
    }

    function destroy() {
      var i = LIVE.indexOf(ann);
      if (i !== -1) LIVE.splice(i, 1);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', fit);
      if (ro) ro.disconnect();
      bar.remove();
      canvas.remove();
    }

    var ann = {
      getAnnotations: getAnnotations,
      setTool: setTool,
      undo: undo,
      redo: redo,
      clear: clear,
      destroy: destroy,
      stage: stage,
      toolbar: bar,
    };
    LIVE.push(ann);
    return ann;
  }

  // ---------------------------------------------------- ImageCompareSlider

  function slider(container, opts) {
    opts = opts || {};
    if (!opts.a || !opts.b) throw new Error('ImageCompareSlider needs { a: imgEl, b: imgEl }');

    var stage = document.createElement('div');
    stage.style.cssText = 'position:relative;display:block;max-width:100%;line-height:0;user-select:none;';
    container.appendChild(stage);

    // Base: image B in flow defines the stage size.
    var b = opts.b;
    b.style.display = 'block';
    b.style.width = '100%';
    b.style.height = 'auto';
    stage.appendChild(b);

    // Top: a CLONE of image A (the caller keeps its own element).
    var top = opts.a.cloneNode(true);
    top.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:fill;';
    stage.appendChild(top);

    function chip(text, side) {
      var c = document.createElement('span');
      c.textContent = text;
      c.style.cssText = 'position:absolute;top:8px;' + (side === 'left' ? 'left:8px' : 'right:8px') +
        'font:600 12px/1 system-ui,sans-serif;padding:4px 10px;border-radius:999px;' +
        'background:rgba(0,0,0,0.55);color:#fff;z-index:2;';
      return c;
    }
    stage.appendChild(chip(opts.labelA || 'A', 'left'));
    stage.appendChild(chip(opts.labelB || 'B', 'right'));

    var handle = document.createElement('div');
    handle.setAttribute('role', 'slider');
    handle.setAttribute('tabindex', '0');
    handle.setAttribute('aria-label', 'Comparison divider');
    handle.setAttribute('aria-valuemin', '0');
    handle.setAttribute('aria-valuemax', '100');
    handle.style.cssText = 'position:absolute;top:0;bottom:0;width:4px;margin-left:-2px;background:#fff;' +
      'box-shadow:0 0 6px rgba(0,0,0,0.5);cursor:ew-resize;z-index:1;';
    var knob = document.createElement('div');
    knob.textContent = '\u27F4';
    knob.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:34px;height:34px;' +
      'border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);display:flex;align-items:center;' +
      'justify-content:center;font:600 14px/1 system-ui,sans-serif;color:#333;';
    handle.appendChild(knob);
    stage.appendChild(handle);

    var pos = clamp01(opts.start == null ? 0.5 : opts.start);

    function setPos(p) {
      pos = clamp01(p);
      // Round to 0.1% so percentages stay clean (1 - 0.7 is 0.2999… in fp).
      var right = Math.round((1 - pos) * 1000) / 10;
      var left = Math.round(pos * 1000) / 10;
      top.style.clipPath = 'inset(0 ' + right + '% 0 0)';
      handle.style.left = left + '%';
      handle.setAttribute('aria-valuenow', String(Math.round(pos * 100)));
    }
    function posFromEvent(e) {
      var r = stage.getBoundingClientRect();
      if (r.width < 1) return pos;
      return clamp01((e.clientX - r.left) / r.width);
    }
    setPos(pos);

    stage.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      stage.setPointerCapture(e.pointerId);
      setPos(posFromEvent(e));
    });
    stage.addEventListener('pointermove', function (e) {
      if (e.buttons & 1) setPos(posFromEvent(e));
    });
    handle.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 0.1 : 0.02;
      if (e.key === 'ArrowLeft') { setPos(pos - step); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { setPos(pos + step); e.preventDefault(); }
      else if (e.key === 'Home') { setPos(0); e.preventDefault(); }
      else if (e.key === 'End') { setPos(1); e.preventDefault(); }
    });

    function destroy() {
      stage.remove();
    }
    return { getPos: function () { return pos; }, setPos: setPos, destroy: destroy, stage: stage };
  }

  window.ImageAnnotator = { mount: mount };
  window.ImageCompareSlider = slider;
})();
