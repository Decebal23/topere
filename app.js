// Toppere A4: cut out pictures from screenshots and lay them out on a print-ready A4 sheet.
const BG_LIB = "https://esm.sh/@imgly/background-removal@1.4.5";
const A4W = 2480, A4H = 3508;          // A4 at 300 DPI
const MM = 300 / 25.4;                 // pixels per mm
const GAP_MM = 2;

const $ = id => document.getElementById(id);
const state = { pieces: [], order: [], rows: 4, cols: 4, cache: new Map() };
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
        for (const c of splitAlpha(masked)) { state.pieces.push({ id: nextId++, canvas: c, thumb: thumb(c) }); added++; }
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
  state.order = [];
  renderPieces(); renderSheet();
}

function onProgress(key, cur, total) {
  if (key.startsWith("fetch") && total) {
    status(`Se descarcă unealta de decupat (doar prima dată)… ${Math.round(cur / total * 100)}%`);
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
  // Tall phone screenshot: ignore the status bar at the top and the app's buttons at the bottom.
  const phone = H / W > 1.6, top = phone ? Math.round(h * 0.05) : 0, bottom = phone ? Math.round(h * 0.835) : h;
  if (phone) { fg.fill(0, 0, top * w); fg.fill(0, bottom * w); }
  const { lab, comps } = label(erode(fg, w, h, 1), w, h);
  let biggest = 0;
  for (const c of comps) if (c.area > biggest) biggest = c.area;
  const keep = comps.filter(c => c.area >= biggest * 0.04 && c.area >= n * 0.002);
  if (!keep.length) return whole;
  dropUnkept(lab, keep);
  grow(lab, w, h);
  if (phone) { lab.fill(0, 0, top * w); lab.fill(0, bottom * w); }
  boxes(lab, fg, w, keep);

  return sortReading(keep, h).map(c => {
    const pad = Math.round(Math.max(c.x1 - c.x0, c.y1 - c.y0) * 0.04) + 4;
    const bx0 = Math.max(0, c.x0 - pad), by0 = Math.max(0, c.y0 - pad);
    const bx1 = Math.min(w - 1, c.x1 + pad), by1 = Math.min(h - 1, c.y1 + pad);
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    const m = canvas(bw, bh), mx = m.getContext("2d"), md = mx.createImageData(bw, bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (lab[(by0 + y) * w + bx0 + x] === c.id) md.data[(y * bw + x) * 4 + 3] = 255;
    mx.putImageData(md, 0, 0);
    const X = Math.floor(bx0 / s), Y = Math.floor(by0 / s);
    return { x: X, y: Y, w: Math.min(W - X, Math.ceil(bw / s)), h: Math.min(H - Y, Math.ceil(bh / s)), mask: m };
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
function splitAlpha(c) {
  const W = c.width, H = c.height, s = Math.min(1, 700 / Math.max(W, H));
  const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s)), n = w * h;
  const sc = canvas(w, h), sx = sc.getContext("2d", { willReadFrequently: true });
  sx.drawImage(c, 0, 0, w, h);
  const px = sx.getImageData(0, 0, w, h).data;
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) solid[i] = px[i * 4 + 3] > 100 ? 1 : 0;
  // Shrink by more and more until overlapping pictures come apart; keep the split with the most real pieces.
  let best = null;
  for (const r of [3, 7, 12]) {
    const res = label(erode(solid, w, h, r), w, h);
    let biggest = 0;
    for (const k of res.comps) if (k.area > biggest) biggest = k.area;
    // Stronger shrinking only counts pieces that are close to full size, so a tail never becomes its own picture.
    res.keep = res.comps.filter(k => k.area >= biggest * (r === 3 ? 0.2 : 0.35) && k.area >= n * 0.002);
    if (!best || res.keep.length > best.keep.length) best = res;
  }
  const { lab, keep } = best;
  if (!keep.length) return [];
  dropUnkept(lab, keep);
  grow(lab, w, h);
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
    `<div class="piece"><img src="${p.thumb}" alt=""><button type="button" data-del="${p.id}" aria-label="Scoate">✕</button></div>`).join("");
}
$("pieces").addEventListener("click", e => {
  const b = e.target.closest("[data-del]"); if (!b) return;
  const id = +b.dataset.del;
  state.pieces = state.pieces.filter(p => p.id !== id);
  state.order = [];
  renderPieces(); renderSheet();
});
$("clearAll").addEventListener("click", () => {
  state.pieces = []; state.order = []; state.cache.clear();
  renderPieces(); renderSheet(); status("Alege pozele din nou.");
});

/* ---------- 3. A4 sheet ---------- */
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

function sticker(p, cw, ch, ratio) {
  const key = `${p.id}|${cw}|${ch}|${ratio}`;
  if (state.cache.has(key)) return state.cache.get(key);
  const o = Math.round(Math.min(cw, ch) * ratio), line = o ? 3 : 0, pad = o + line + 2;
  const k = Math.min((cw - 2 * pad) / p.canvas.width, (ch - 2 * pad) / p.canvas.height);
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
  state.cache.set(key, c);
  return c;
}

function renderSheet() {
  $("rowsOut").textContent = state.rows; $("colsOut").textContent = state.cols;
  $("step3").hidden = !state.pieces.length;
  if (!state.pieces.length) return;
  const N = state.rows * state.cols;
  const known = new Set(state.pieces.map(p => p.id));
  if (state.order.length !== N || state.order.some(id => !known.has(id))) state.order = arrange(false);

  const c = $("sheet"), x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, A4W, A4H);
  const m = +$("margin").value * MM, g = GAP_MM * MM, ratio = +$("outline").value;
  const cw = Math.floor((A4W - 2 * m - (state.cols - 1) * g) / state.cols);
  const ch = Math.floor((A4H - 2 * m - (state.rows - 1) * g) / state.rows);
  const byId = new Map(state.pieces.map(p => [p.id, p]));
  state.order.forEach((id, i) => {
    const r = Math.floor(i / state.cols), col = i % state.cols, st = sticker(byId.get(id), cw, ch, ratio);
    const cx = m + col * (cw + g), cy = m + r * (ch + g);
    x.drawImage(st, Math.round(cx + (cw - st.width) / 2), Math.round(cy + (ch - st.height) / 2));
  });

  const n = state.pieces.length;
  const size = `Fiecare topper are cel mult ${(cw / MM / 10).toFixed(1)} × ${(ch / MM / 10).toFixed(1)} cm.`;
  $("info").textContent = n > N
    ? `Ai ${n} desene, dar încap ${N}. Apar primele ${N}; scoate ce nu vrei sau pune mai multe rânduri. ${size}`
    : n < N ? `${n} desene repetate pe ${N} locuri. ${size}` : `${N} desene. ${size}`;
}

document.querySelectorAll("[data-step]").forEach(b => b.addEventListener("click", () => {
  const [k, d] = b.dataset.step.split(":");
  state[k] = Math.max(1, Math.min(8, state[k] + +d));
  state.order = []; saveSettings(); renderSheet();
}));
$("outline").addEventListener("change", () => { saveSettings(); renderSheet(); });
$("margin").addEventListener("change", () => { saveSettings(); renderSheet(); });
$("shuffle").addEventListener("click", () => { state.order = arrange(true); renderSheet(); });

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
  const blob = await new Promise(r => $("sheet").toBlob(r, "image/png"));
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

/* ---------- start ---------- */
$("files").addEventListener("change", e => { const f = [...e.target.files]; e.target.value = ""; processFiles(f); });
window.__toppere = { processFiles, state, sheetBlob };   // used for testing
renderSheet();
