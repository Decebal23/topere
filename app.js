// Toppere A4: cut out pictures from screenshots and lay them out on a print-ready A4 sheet.
import { THEMES, STYLES, searchWords, googleUrl, pinterestUrl } from "./theme.js";
const BG_LIB = "https://esm.sh/@imgly/background-removal@1.4.5";
const A4W = 2480, A4H = 3508;          // A4 at 300 DPI
const MM = 300 / 25.4;                 // pixels per mm
const GAP_MM = 2;

const $ = id => document.getElementById(id);
const state = { pieces: [], items: [], sel: -1, rows: 4, cols: 4, cache: new Map() };
let nextId = 1, bgLib = null, busy = false;

/* ---------- settings ---------- */
try {
  const s = JSON.parse(localStorage.getItem("toppere-a4") || "null");
  if (s) {
    state.rows = s.rows || 4; state.cols = s.cols || 4;
    if (s.outline != null) $("outline").value = s.outline;
    if (s.margin != null) $("margin").value = s.margin;
  }
} catch (e) {}
function saveSettings() {
  try { localStorage.setItem("toppere-a4", JSON.stringify({ rows: state.rows, cols: state.cols, outline: $("outline").value, margin: $("margin").value })); } catch (e) {}
}

/* ---------- small helpers ---------- */
function canvas(w, h) { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
function status(text, err = false) { const el = $("status"); el.textContent = text; el.classList.toggle("err", err); }
function bar(f) { $("barFill").style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + "%"; }
function setBusy(b) { busy = b; $("pickBtn").setAttribute("aria-disabled", b); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- 1. cut out ---------- */
async function loadLib() {
  if (!bgLib) bgLib = await import(BG_LIB);
  return bgLib;
}

async function processFiles(files) {
  if (busy || !files.length) return;
  setBusy(true);
  let lib;
  try { lib = await loadLib(); }
  catch (e) { console.error(e); status("Nu s-a putut încărca unealta de decupat. Verifică internetul și încearcă iar.", true); setBusy(false); return; }

  let added = 0, failed = 0;
  for (let i = 0; i < files.length; i++) {
    const tag = files.length > 1 ? ` (poza ${i + 1} din ${files.length})` : "";
    status(`Caut desenele${tag}…`);
    bar(i / files.length);
    try {
      const orig = await createImageBitmap(files[i]);
      const regions = findRegions(orig);
      for (let k = 0; k < regions.length; k++) {
        status(`Decupez desenul ${k + 1} din ${regions.length}${tag}…`);
        bar((i + k / regions.length) / files.length);
        const r = regions[k];
        const crop = canvas(r.w, r.h);
        crop.getContext("2d").drawImage(orig, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        const blob = await lib.removeBackground(await toBlob(crop), BG_CONFIG);
        const cut = await createImageBitmap(blob);
        const masked = canvas(r.w, r.h), mx = masked.getContext("2d");
        mx.drawImage(cut, 0, 0, r.w, r.h);
        if (r.mask) { mx.globalCompositeOperation = "destination-in"; mx.drawImage(r.mask, 0, 0, r.w, r.h); }
        if (r.solid) {
          // Put back anything that isn't background colour, in case the AI removed part of the picture.
          const keep = canvas(r.w, r.h), kx = keep.getContext("2d");
          kx.drawImage(crop, 0, 0);
          kx.globalCompositeOperation = "destination-in"; kx.drawImage(r.solid, 0, 0, r.w, r.h);
          mx.globalCompositeOperation = "source-over"; mx.drawImage(keep, 0, 0);
        }
        for (const c of splitAlpha(masked, !!r.mask)) { state.pieces.push({ id: nextId++, canvas: c, thumb: thumb(c) }); added++; }
      }
    } catch (e) {
      console.error(e);
      failed++;
      status(`Poza ${i + 1} nu a mers (${e.message || e}).`, true);
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  bar(0); setBusy(false);
  const failText = failed ? ` ${failed} ${failed === 1 ? "poză nu a mers" : "poze nu au mers"}; încearcă-le din nou.` : "";
  status((added ? `Gata: am găsit ${added} desene.` : "Nu am găsit niciun desen.") + failText, !added || failed > 0);
  renderPieces();
  if (!state.items.length && state.pieces.length) autoFill(false, false); else renderSheet();
}

function onProgress(key, cur, total) {
  if (key.startsWith("fetch") && total) {
    status(`Pregătesc unealta de decupat… ${Math.round(cur / total * 100)}%`);
    bar(cur / total);
  }
}
// One shared settings object: the library keeps its AI model loaded only while it gets the same object.
const BG_CONFIG = { model: "small", output: { format: "image/png" }, progress: onProgress };
function toBlob(c) { return new Promise(r => c.toBlob(r, "image/png")); }

// Step A: split the screenshot into one region per picture, using its plain background
// (white phone border, grey or white behind the pictures). No AI needed for this part.
function findRegions(orig) {
  const W = orig.width, H = orig.height, s = Math.min(1, 700 / Math.max(W, H));
  const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s)), n = w * h;
  const sc = canvas(w, h), sx = sc.getContext("2d", { willReadFrequently: true });
  sx.drawImage(orig, 0, 0, w, h);
  const op = sx.getImageData(0, 0, w, h).data;
  const whole = [{ x: 0, y: 0, w: W, h: H, mask: null }];

  const bg = backgroundMask(op, w, h);
  let bgCount = 0;
  for (let i = 0; i < n; i++) bgCount += bg[i];
  if (bgCount < n * 0.15) return whole;   // no plain background: let the AI handle the whole picture

  const fg = new Uint8Array(n);
  for (let i = 0; i < n; i++) fg[i] = bg[i] ? 0 : 1;
  // Tall phone screenshot: ignore the status bar and the app's buttons when looking for pictures.
  // shortcut: a picture reaching into the bottom 16.5% gets cropped there; fine for Pinterest screenshots so far.
  if (H / W > 1.6) { fg.fill(0, 0, Math.round(h * 0.05) * w); fg.fill(0, Math.round(h * 0.835) * w); }
  const core = erode(fg, w, h, 1);
  const { lab, comps } = label(core, w, h);
  let biggest = 0;
  for (const c of comps) if (c.area > biggest) biggest = c.area;
  let keep = comps.filter(c => c.area >= biggest * 0.04 && c.area >= n * 0.002);
  if (!keep.length) return whole;
  // A piece lying mostly inside another piece's box is part of the same picture (white icing on a
  // cookie's edge looks like background and slices a leg off), so merge it into the bigger one.
  keep.sort((a, b) => b.area - a.area);
  const into = new Map();
  for (let i = keep.length - 1; i > 0; i--) {
    const a = keep[i], box = c => (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1);
    for (let j = 0; j < i; j++) {
      const b = keep[j];
      const ow = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1, oh = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1;
      if (ow > 0 && oh > 0 && ow * oh > 0.5 * box(a)) {
        into.set(a.id, b.id);
        b.x0 = Math.min(b.x0, a.x0); b.y0 = Math.min(b.y0, a.y0); b.x1 = Math.max(b.x1, a.x1); b.y1 = Math.max(b.y1, a.y1);
        break;
      }
    }
  }
  const root = id => { while (into.has(id)) id = into.get(id); return id; };
  if (into.size) for (let i = 0; i < n; i++) if (into.has(lab[i])) lab[i] = root(lab[i]);
  keep = keep.filter(c => !into.has(c.id));
  dropUnkept(lab, keep);
  const own = lab.slice();   // each picture's own shape, before it takes over nearby pixels
  grow(lab, w, h);
  boxes(lab, fg, w, keep);

  return sortReading(keep, h).map(c => {
    const pad = Math.round(Math.max(c.x1 - c.x0, c.y1 - c.y0) * 0.04) + 4;
    const bx0 = Math.max(0, c.x0 - pad), by0 = Math.max(0, c.y0 - pad);
    const bx1 = Math.min(w - 1, c.x1 + pad), by1 = Math.min(h - 1, c.y1 + pad);
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    // mask: this picture's share of the screenshot; solid: its own main shape (not background colour, no nearby icons).
    const m = canvas(bw, bh), mx = m.getContext("2d"), md = mx.createImageData(bw, bh);
    const sm = canvas(bw, bh), smx = sm.getContext("2d"), sd = smx.createImageData(bw, bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = (by0 + y) * w + bx0 + x;
      if (lab[i] !== c.id) continue;
      md.data[(y * bw + x) * 4 + 3] = 255;
      if (core[i] && own[i] === c.id) sd.data[(y * bw + x) * 4 + 3] = 255;
    }
    mx.putImageData(md, 0, 0); smx.putImageData(sd, 0, 0);
    const X = Math.floor(bx0 / s), Y = Math.floor(by0 / s);
    return { x: X, y: Y, w: Math.min(W - X, Math.ceil(bw / s)), h: Math.min(H - Y, Math.ceil(bh / s)), mask: m, solid: sm };
  });
}

// Plain background: the few colours that cover big parts of the picture, flooded in from the edges.
function backgroundMask(op, w, h) {
  const n = w * h, hist = new Map();
  for (let i = 0; i < n; i++) {
    const k = ((op[i * 4] >> 4) << 8) | ((op[i * 4 + 1] >> 4) << 4) | (op[i * 4 + 2] >> 4);
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  const pal = [...hist].filter(([, c]) => c > n * 0.05).sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([k]) => [((k >> 8) & 15) * 16 + 8, ((k >> 4) & 15) * 16 + 8, (k & 15) * 16 + 8]);
  const bg = new Uint8Array(n);
  if (!pal.length) return bg;
  const T2 = 24 * 24;
  const near = i => pal.some(([r, g, b]) => { const dr = op[i * 4] - r, dg = op[i * 4 + 1] - g, db = op[i * 4 + 2] - b; return dr * dr + dg * dg + db * db < T2; });
  const q = new Int32Array(n);
  let qh = 0, qt = 0;
  const seed = i => { if (!bg[i] && near(i)) { bg[i] = 1; q[qt++] = i; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (qh < qt) {
    const p = q[qh++], x = p % w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w);
    if (p < n - w) seed(p + w);
  }
  return bg;
}

// Step B: after the AI cut-out, split anything still stuck together.
// single: the picture was already separated by background colour, so keep it whole (never split off a leg or a tail).
function splitAlpha(c, single) {
  const W = c.width, H = c.height, s = Math.min(1, 700 / Math.max(W, H));
  const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s)), n = w * h;
  const sc = canvas(w, h), sx = sc.getContext("2d", { willReadFrequently: true });
  sx.drawImage(c, 0, 0, w, h);
  const px = sx.getImageData(0, 0, w, h).data;
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) solid[i] = px[i * 4 + 3] > 100 ? 1 : 0;
  let lab, keep;
  if (single) { lab = new Int32Array(n).fill(1); keep = [{ id: 1 }]; }
  else {
    // Busy background: shrink a little so pictures that touch come apart.
    ({ lab, comps: keep } = label(erode(solid, w, h, 3), w, h));
    let biggest = 0;
    for (const k of keep) if (k.area > biggest) biggest = k.area;
    keep = keep.filter(k => k.area >= biggest * 0.2 && k.area >= n * 0.002);
    if (!keep.length) return [];
    dropUnkept(lab, keep);
    grow(lab, w, h);
  }
  // Throw away small loose bits (pieces of app icons, specks) that don't touch a picture.
  const loose = label(solid, w, h);
  let maxArea = 0;
  for (const k of loose.comps) if (k.area > maxArea) maxArea = k.area;
  const tiny = new Set(loose.comps.filter(k => k.area < maxArea * 0.04).map(k => k.id));
  for (let i = 0; i < n; i++) if (tiny.has(loose.lab[i])) { lab[i] = 0; solid[i] = 0; }
  boxes(lab, solid, w, keep);
  return sortReading(keep, h).map(k => extract(c, lab, w, s, k));
}

function label(mask, w, h) {
  const n = w * h, lab = new Int32Array(n), stack = new Int32Array(n), comps = [];
  for (let i = 0; i < n; i++) {
    if (!mask[i] || lab[i]) continue;
    const id = comps.length + 1;
    let sp = 0, area = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack[sp++] = i; lab[i] = id;
    while (sp) {
      const p = stack[--sp], x = p % w, y = (p / w) | 0;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !lab[p - w]) { lab[p - w] = id; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !lab[p + w]) { lab[p + w] = id; stack[sp++] = p + w; }
    }
    comps.push({ id, area, x0, y0, x1, y1 });
  }
  return { lab, comps };
}

function dropUnkept(lab, keep) {
  const kept = new Set(keep.map(c => c.id));
  for (let i = 0; i < lab.length; i++) if (lab[i] && !kept.has(lab[i])) lab[i] = 0;
}

// Give every pixel to the nearest kept shape, so tails, whiskers and edges go back to their own picture.
function grow(lab, w, h) {
  const n = w * h, q = new Int32Array(n);
  let qh = 0, qt = 0;
  for (let i = 0; i < n; i++) if (lab[i]) q[qt++] = i;
  while (qh < qt) {
    const p = q[qh++], x = p % w, id = lab[p];
    if (x > 0 && !lab[p - 1]) { lab[p - 1] = id; q[qt++] = p - 1; }
    if (x < w - 1 && !lab[p + 1]) { lab[p + 1] = id; q[qt++] = p + 1; }
    if (p >= w && !lab[p - w]) { lab[p - w] = id; q[qt++] = p - w; }
    if (p < n - w && !lab[p + w]) { lab[p + w] = id; q[qt++] = p + w; }
  }
}

function boxes(lab, solid, w, keep) {
  const byId = new Map(keep.map(c => [c.id, c]));
  for (const c of keep) { c.x0 = Infinity; c.y0 = Infinity; c.x1 = -1; c.y1 = -1; }
  for (let i = 0; i < lab.length; i++) {
    if (!solid[i]) continue;
    const c = byId.get(lab[i]); if (!c) continue;
    const x = i % w, y = (i / w) | 0;
    if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
  }
  for (const c of keep) if (c.x1 < 0) { c.x0 = 0; c.y0 = 0; c.x1 = 0; c.y1 = 0; }
}

function sortReading(list, h) {
  const band = h * 0.12;
  return list.sort((a, b) => (Math.round((a.y0 + a.y1) / 2 / band) - Math.round((b.y0 + b.y1) / 2 / band)) || (a.x0 - b.x0));
}

function dilate(src, w, h, r) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0; for (let k = -r; k <= r && !v; k++) { const xx = x + k; if (xx >= 0 && xx < w && src[y * w + xx]) v = 1; }
    tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0; for (let k = -r; k <= r && !v; k++) { const yy = y + k; if (yy >= 0 && yy < h && tmp[yy * w + x]) v = 1; }
    out[y * w + x] = v;
  }
  return out;
}

function erode(src, w, h, r) {
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) inv[i] = src[i] ? 0 : 1;
  const d = dilate(inv, w, h, r);
  for (let i = 0; i < w * h; i++) d[i] = d[i] ? 0 : 1;
  return d;
}

function extract(src, lab, w, s, c) {
  const h = lab.length / w, pad = 3;
  const bx0 = Math.max(0, c.x0 - pad), by0 = Math.max(0, c.y0 - pad);
  const bx1 = Math.min(w - 1, c.x1 + pad), by1 = Math.min(h - 1, c.y1 + pad);
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  const m = canvas(bw, bh), mx = m.getContext("2d"), md = mx.createImageData(bw, bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (lab[(by0 + y) * w + bx0 + x] === c.id) md.data[(y * bw + x) * 4 + 3] = 255;
  mx.putImageData(md, 0, 0);

  const X = Math.floor(bx0 / s), Y = Math.floor(by0 / s);
  const FW = Math.min(src.width - X, Math.ceil(bw / s)), FH = Math.min(src.height - Y, Math.ceil(bh / s));
  const out = canvas(FW, FH), ox = out.getContext("2d", { willReadFrequently: true });
  ox.drawImage(src, X, Y, FW, FH, 0, 0, FW, FH);
  ox.globalCompositeOperation = "destination-in";
  ox.drawImage(m, 0, 0, bw, bh, 0, 0, bw / s, bh / s);
  // Firm up the edges: drop the faint haze the cut-out leaves behind, keep soft edges smooth.
  const img = ox.getImageData(0, 0, FW, FH), d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] <= 50 ? 0 : d[i] >= 200 ? 255 : Math.round((d[i] - 50) * 255 / 150);
  ox.putImageData(img, 0, 0);
  return trim(out);
}

function trim(c) {
  const x = c.getContext("2d", { willReadFrequently: true }), d = x.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) {
    if (d[(y * c.width + xx) * 4 + 3] > 12) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return c;
  const out = canvas(x1 - x0 + 1, y1 - y0 + 1);
  out.getContext("2d").drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function thumb(c) {
  const k = Math.min(1, 160 / Math.max(c.width, c.height));
  const t = canvas(c.width * k, c.height * k);
  t.getContext("2d").drawImage(c, 0, 0, t.width, t.height);
  return t.toDataURL("image/png");
}

/* ---------- 2. pieces list ---------- */
function renderPieces() {
  $("step2").hidden = !state.pieces.length;
  $("count").textContent = state.pieces.length;
  $("pieces").innerHTML = state.pieces.map(p =>
    `<div class="piece"><button type="button" class="add" data-add="${p.id}" aria-label="Pune pe foaie"><img src="${p.thumb}" alt=""></button><button type="button" class="del" data-del="${p.id}" aria-label="Scoate">✕</button></div>`).join("");
}
$("pieces").addEventListener("click", e => {
  const add = e.target.closest("[data-add]");
  if (add) { addItem(+add.dataset.add); return; }
  const b = e.target.closest("[data-del]"); if (!b) return;
  const id = +b.dataset.del;
  state.pieces = state.pieces.filter(p => p.id !== id);
  state.items = state.items.filter(it => it.id !== id);
  state.sel = -1;
  renderPieces(); renderSheet();
});
$("clearAll").addEventListener("click", () => {
  state.pieces = []; state.items = []; state.sel = -1; state.cache.clear();
  renderPieces(); renderSheet(); status("Alege pozele din nou.");
});

/* ---------- 3. A4 sheet ---------- */
// Each topper on the sheet: { id: piece id, x, y, w } in A4 pixels; its height follows the sticker's shape.
const byId = id => state.pieces.find(p => p.id === id);
const ratio = () => +$("outline").value;
const itemH = it => { const s = sticker(byId(it.id), ratio()); return it.w * s.height / s.width; };

// Fill rows*cols slots. With fewer pictures than slots they repeat, avoiding the same picture next to itself.
function arrange(random) {
  const ids = state.pieces.map(p => p.id), N = state.rows * state.cols;
  if (!ids.length) return [];
  if (ids.length >= N) return random ? shuffle(ids.slice()).slice(0, N) : ids.slice(0, N);
  let pool = [];
  while (pool.length < N) pool.push(...ids);
  pool = pool.slice(0, N);
  if (ids.length === 1) return pool;
  for (let attempt = 0; attempt < 300; attempt++) {
    const rem = shuffle(pool.slice()), out = [];
    let ok = true;
    for (let i = 0; i < N; i++) {
      const left = i % state.cols ? out[i - 1] : null, up = i >= state.cols ? out[i - state.cols] : null;
      const j = rem.findIndex(v => v !== left && v !== up);
      if (j < 0) { ok = false; break; }
      out.push(rem.splice(j, 1)[0]);
    }
    if (ok) return out;
  }
  return shuffle(pool);
}

function autoFill(random, ask = true) {
  if (ask && state.items.length && !confirm("Înlocuiesc toppere de pe foaie cu o grilă nouă?")) return;
  const m = +$("margin").value * MM, g = GAP_MM * MM;
  const cw = (A4W - 2 * m - (state.cols - 1) * g) / state.cols, ch = (A4H - 2 * m - (state.rows - 1) * g) / state.rows;
  state.items = arrange(random).map((id, i) => {
    const s = sticker(byId(id), ratio()), k = Math.min(cw / s.width, ch / s.height), w = s.width * k, h = s.height * k;
    const cx = m + (i % state.cols) * (cw + g), cy = m + Math.floor(i / state.cols) * (ch + g);
    return { id, x: cx + (cw - w) / 2, y: cy + (ch - h) / 2, w };
  });
  state.sel = -1;
  renderSheet();
}

function addItem(id) {
  const w = (A4W - 2 * +$("margin").value * MM) / 4, n = state.items.length % 8;
  state.items.push({ id, x: A4W / 2 - w / 2 + n * 60, y: A4H / 3 + n * 60, w });
  state.sel = state.items.length - 1;
  renderSheet();
  $("sheet").scrollIntoView({ behavior: "smooth", block: "center" });
}

// One sticker image per picture (white outline + thin grey cut line), drawn at any size on the sheet.
function sticker(p, ratio) {
  const key = `${p.id}|${ratio}`;
  if (state.cache.has(key)) return state.cache.get(key);
  const BOX = 1200, o = Math.round(BOX * ratio), line = o ? 3 : 0, pad = o + line + 2;
  const k = Math.min((BOX - 2 * pad) / p.canvas.width, (BOX - 2 * pad) / p.canvas.height);
  const iw = Math.max(1, Math.round(p.canvas.width * k)), ih = Math.max(1, Math.round(p.canvas.height * k));
  const c = canvas(iw + 2 * pad, ih + 2 * pad), x = c.getContext("2d");
  x.imageSmoothingQuality = "high";
  if (o) {
    const sil = color => {
      const t = canvas(iw, ih), tx = t.getContext("2d");
      tx.drawImage(p.canvas, 0, 0, iw, ih);
      tx.globalCompositeOperation = "source-in"; tx.fillStyle = color; tx.fillRect(0, 0, iw, ih);
      return t;
    };
    const ring = (img, r) => {
      const n = Math.min(64, Math.max(16, Math.ceil(r * 2)));
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; x.drawImage(img, pad + Math.cos(a) * r, pad + Math.sin(a) * r); }
    };
    const grey = sil("#c9c9c9"), white = sil("#ffffff");
    ring(grey, o + line);
    for (const r of [o, o * 0.66, o * 0.33]) ring(white, r);
    x.drawImage(white, pad, pad);
  }
  x.drawImage(p.canvas, pad, pad, iw, ih);
  const red = canvas(c.width, c.height), rx = red.getContext("2d");
  rx.drawImage(c, 0, 0); rx.globalCompositeOperation = "source-in"; rx.fillStyle = "#e03131"; rx.fillRect(0, 0, c.width, c.height);
  c.red = red;
  state.cache.set(key, c);
  return c;
}

// Which toppers touch another one: checked on a 1/8-size copy of the sheet, by their real shapes.
function overlapping() {
  const S = 8, L = canvas(A4W / S, A4H / S), lx = L.getContext("2d", { willReadFrequently: true });
  const owner = new Int16Array(L.width * L.height).fill(-1), hit = new Set();
  state.items.forEach((it, i) => {
    const h = itemH(it);
    const x0 = Math.max(0, Math.floor(it.x / S)), y0 = Math.max(0, Math.floor(it.y / S));
    const x1 = Math.min(L.width, Math.ceil((it.x + it.w) / S)), y1 = Math.min(L.height, Math.ceil((it.y + h) / S));
    if (x1 <= x0 || y1 <= y0) return;
    lx.clearRect(0, 0, L.width, L.height);
    lx.drawImage(sticker(byId(it.id), ratio()), it.x / S, it.y / S, it.w / S, h / S);
    const d = lx.getImageData(x0, y0, x1 - x0, y1 - y0).data, bw = x1 - x0;
    for (let k = 3, p = 0; k < d.length; k += 4, p++) {
      if (d[k] < 100) continue;
      const at = (y0 + Math.floor(p / bw)) * L.width + x0 + (p % bw);
      if (owner[at] >= 0 && owner[at] !== i) { hit.add(owner[at]); hit.add(i); }
      owner[at] = i;
    }
  });
  return hit;
}

function draw(forPrint) {
  const c = $("sheet"), x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, A4W, A4H);
  const hit = forPrint ? new Set() : overlapping();
  state.items.forEach((it, i) => {
    const s = sticker(byId(it.id), ratio()), h = itemH(it);
    x.drawImage(s, it.x, it.y, it.w, h);
    if (hit.has(i)) { x.globalAlpha = 0.5; x.drawImage(s.red, it.x, it.y, it.w, h); x.globalAlpha = 1; }
  });
  const it = state.items[state.sel];
  if (!forPrint && it) {
    const h = itemH(it), R = handleR();
    x.setLineDash([24, 16]); x.lineWidth = 6; x.strokeStyle = "#d6336c"; x.strokeRect(it.x, it.y, it.w, h); x.setLineDash([]);
    x.fillStyle = "#d6336c"; x.beginPath(); x.arc(it.x + it.w, it.y + h, R * 0.6, 0, 7); x.fill();
    x.fillStyle = "#333"; x.beginPath(); x.arc(it.x + it.w, it.y, R * 0.6, 0, 7); x.fill();
    x.strokeStyle = "#fff"; x.lineWidth = R * 0.12; const d = R * 0.25;
    x.beginPath(); x.moveTo(it.x + it.w - d, it.y - d); x.lineTo(it.x + it.w + d, it.y + d);
    x.moveTo(it.x + it.w + d, it.y - d); x.lineTo(it.x + it.w - d, it.y + d); x.stroke();
  }
  return hit;
}

function renderSheet() {
  $("rowsOut").textContent = state.rows; $("colsOut").textContent = state.cols;
  $("fillBtn").textContent = `▦ Umple automat (${state.rows} × ${state.cols})`;
  $("step3").hidden = !state.pieces.length;
  if (!state.pieces.length) return;
  const hit = draw(false), n = state.items.length;
  $("info").textContent = (n ? `${n} toppere pe foaie. Atinge unul ca să-l muți, să-l mărești (punctul din colț) sau să-l ștergi (✕).` : "Foaia e goală: atinge un desen de mai sus sau „Umple automat”.")
    + (hit.size ? ` ⚠ ${hit.size} toppere se ating (marcate cu roșu).` : "");
  $("info").classList.toggle("warn", hit.size > 0);
}

// Touch / mouse on the sheet: select, move, resize, delete.
const handleR = () => { const r = $("sheet").getBoundingClientRect(); return 22 * A4W / (r.width || A4W); };
function toSheet(e) { const r = $("sheet").getBoundingClientRect(); return [(e.clientX - r.left) * A4W / r.width, (e.clientY - r.top) * A4H / r.height]; }
let drag = null, frame = 0;
$("sheet").addEventListener("pointerdown", e => {
  const [px, py] = toSheet(e), R = handleR(), near = (ax, ay) => Math.hypot(px - ax, py - ay) < R;
  const sel = state.items[state.sel];
  if (sel) {
    const h = itemH(sel);
    if (near(sel.x + sel.w, sel.y)) { state.items.splice(state.sel, 1); state.sel = -1; renderSheet(); return; }
    if (near(sel.x + sel.w, sel.y + h)) { drag = { mode: "resize" }; $("sheet").setPointerCapture(e.pointerId); return; }
  }
  let i = state.items.length - 1;
  while (i >= 0) { const it = state.items[i]; if (px >= it.x && px <= it.x + it.w && py >= it.y && py <= it.y + itemH(it)) break; i--; }
  if (i < 0) { state.sel = -1; renderSheet(); return; }
  const [it] = state.items.splice(i, 1);   // bring to front
  state.items.push(it); state.sel = state.items.length - 1;
  drag = { mode: "move", dx: px - it.x, dy: py - it.y };
  $("sheet").setPointerCapture(e.pointerId);
  renderSheet();
});
$("sheet").addEventListener("pointermove", e => {
  const it = state.items[state.sel];
  if (!drag || !it) return;
  const [px, py] = toSheet(e);
  if (drag.mode === "move") { it.x = px - drag.dx; it.y = py - drag.dy; }
  else it.w = Math.max(100, px - it.x);
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; renderSheet(); });
});
for (const ev of ["pointerup", "pointercancel"]) $("sheet").addEventListener(ev, () => { drag = null; });

document.querySelectorAll("[data-step]").forEach(b => b.addEventListener("click", () => {
  const [k, d] = b.dataset.step.split(":");
  state[k] = Math.max(1, Math.min(8, state[k] + +d));
  saveSettings(); renderSheet();
}));
$("outline").addEventListener("change", () => { saveSettings(); renderSheet(); });
$("margin").addEventListener("change", saveSettings);
$("fillBtn").addEventListener("click", () => autoFill(false));
$("shuffle").addEventListener("click", () => autoFill(true));

/* ---------- export ---------- */
// Add a pHYs chunk so the PNG says 300 DPI (prints as A4 at 100%).
function crc32(bytes) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < bytes.length; n++) {
    c = (crc ^ bytes[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
async function sheetBlob() {
  draw(true);   // without selection marks or red overlap marks
  const blob = await new Promise(r => $("sheet").toBlob(r, "image/png"));
  renderSheet();
  const src = new Uint8Array(await blob.arrayBuffer());
  const chunk = new Uint8Array(21), dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9); chunk.set([112, 72, 89, 115], 4);              // "pHYs"
  dv.setUint32(8, 11811); dv.setUint32(12, 11811); chunk[16] = 1;    // 300 DPI in pixels per metre
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  const out = new Uint8Array(src.length + 21);
  out.set(src.subarray(0, 33)); out.set(chunk, 33); out.set(src.subarray(33), 54);
  return new Blob([out], { type: "image/png" });
}
function fileName() { const d = new Date(); return `toppere-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.png`; }
function download(blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = fileName();
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
$("download").addEventListener("click", async () => download(await sheetBlob()));
$("share").addEventListener("click", async () => {
  const blob = await sheetBlob(), file = new File([blob], fileName(), { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Toppere A4" }); } catch (e) { if (e.name !== "AbortError") download(blob); }
  } else download(blob);
});

/* ---------- search for models ---------- */
const themeSel = $("themeSel"), styleSel = $("styleSel"), themeText = $("themeText");
themeSel.innerHTML = `<option value="">— alege —</option>` + THEMES.map(t => `<option value="${t.id}">${t.ro}</option>`).join("");
styleSel.innerHTML = STYLES.map(s => `<option value="${s.id}">${s.ro}</option>`).join("");
let guessed = [];

function updateSearch() {
  const theme = THEMES.find(t => t.id === themeSel.value), custom = themeText.value.trim();
  const words = searchWords(theme, styleSel.value, custom);
  $("searchWords").textContent = words ? `Caut: „${words}”` : "Alege o temă sau pune poza unui tort.";
  for (const [id, url] of [["googleBtn", googleUrl], ["pinBtn", pinterestUrl]]) {
    const a = $(id);
    if (words) { a.href = url(words); a.removeAttribute("aria-disabled"); }
    else { a.removeAttribute("href"); a.setAttribute("aria-disabled", "true"); }
  }
  $("themeChips").innerHTML = guessed.map(g =>
    `<button type="button" data-theme="${g.item.id}" class="${g.item.id === themeSel.value && !custom ? "on" : ""}">${g.item.ro} ${Math.round(g.p * 100)}%</button>`).join("");
}
themeSel.addEventListener("change", () => { themeText.value = ""; updateSearch(); });
styleSel.addEventListener("change", updateSearch);
themeText.addEventListener("input", () => { if (themeText.value.trim()) themeSel.value = ""; updateSearch(); });
$("themeChips").addEventListener("click", e => {
  const b = e.target.closest("[data-theme]"); if (!b) return;
  themeSel.value = b.dataset.theme; themeText.value = ""; updateSearch();
});

$("cakePhoto").addEventListener("change", async e => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  const st = $("themeStatus"), btn = $("cakeBtn");
  st.classList.remove("err"); btn.setAttribute("aria-disabled", "true");
  st.textContent = "Mă uit la tort…";
  try {
    const { guess } = await import("./theme.js");
    const res = await guess(file, p => {
      if (p.status === "progress" && /\.onnx$/.test(p.file || "")) st.textContent = `Pregătesc unealta care recunoaște tema… ${Math.round(p.progress)}%`;
    });
    guessed = res.themes.slice(0, 3);
    const top = guessed[0];
    themeSel.value = top.item.id; styleSel.value = res.styles[0].item.id; themeText.value = "";
    st.textContent = top.p >= 0.3
      ? `Cred că e: ${top.item.ro}, ${res.styles[0].item.ro.toLowerCase()}. Dacă nu e bine, alege altă temă mai jos.`
      : "Nu sunt sigur. Alege tema potrivită de mai jos sau scrie-o tu.";
  } catch (err) {
    console.error(err);
    st.textContent = "Nu am putut recunoaște tema. Verifică internetul sau alege tema de mai jos.";
    st.classList.add("err");
  }
  btn.removeAttribute("aria-disabled");
  updateSearch();
});
updateSearch();

/* ---------- start ---------- */
$("files").addEventListener("change", e => { const f = [...e.target.files]; e.target.value = ""; processFiles(f); });
window.__toppere = { processFiles, state, sheetBlob, itemH };   // used for testing
renderSheet();
