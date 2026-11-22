// Guesses a cake's theme and style from a photo, on the phone, with the CLIP image model.
// The text side of CLIP is pre-computed into theme-vectors.js, so the phone only downloads the image model.
const TF = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2";
const MODEL = "Xenova/clip-vit-base-patch32";

// ro: shown to mom; subject: what the AI looks for in the photo (see prompts()); q: English search words.
// character: a named character or person, so the search doesn't add "realistic"/"cartoon".
export const THEMES = [
  { id: "cats", ro: "Pisici", subject: "cats and kittens", q: "kitten" },
  { id: "dogs", ro: "Căței", subject: "dogs and puppies", q: "puppy" },
  { id: "unicorns", ro: "Unicorni", subject: "unicorns", q: "unicorn" },
  { id: "dinosaurs", ro: "Dinozauri", subject: "dinosaurs", q: "dinosaur" },
  { id: "butterflies", ro: "Fluturi", subject: "butterflies", q: "butterfly" },
  { id: "flowers", ro: "Flori", subject: "flowers", q: "flowers" },
  { id: "bears", ro: "Ursuleți", subject: "teddy bears", q: "teddy bear" },
  { id: "horses", ro: "Căluți", subject: "horses", q: "horse" },
  { id: "princess", ro: "Prințese", subject: "princesses", q: "princess" },
  { id: "mermaids", ro: "Sirene", subject: "mermaids", q: "mermaid" },
  { id: "space", ro: "Spațiu / rachete", subject: "rockets, planets and astronauts", q: "rocket astronaut planets" },
  { id: "cars", ro: "Mașini", subject: "cars", q: "race car" },
  { id: "football", ro: "Fotbal", subject: "footballs and soccer players", q: "soccer ball football player" },
  { id: "messi", ro: "Messi", subject: "photos of Lionel Messi", q: "Lionel Messi", character: true },
  { id: "ronaldo", ro: "Ronaldo", subject: "photos of Cristiano Ronaldo", q: "Cristiano Ronaldo", character: true },
  { id: "minecraft", ro: "Minecraft", subject: "Minecraft blocks and characters", q: "Minecraft", character: true },
  { id: "roblox", ro: "Roblox", subject: "Roblox characters", q: "Roblox", character: true },
  { id: "frozen", ro: "Frozen (Elsa)", subject: "Elsa and Anna from Frozen", q: "Frozen Elsa Anna", character: true },
  { id: "spiderman", ro: "Spider-Man", subject: "Spider-Man", q: "Spider-Man", character: true },
  { id: "superheroes", ro: "Super-eroi", subject: "superheroes like Batman and Superman", q: "superheroes", character: true },
  { id: "pawpatrol", ro: "Paw Patrol", subject: "Paw Patrol dogs", q: "Paw Patrol", character: true },
  { id: "peppa", ro: "Peppa Pig", subject: "Peppa Pig", q: "Peppa Pig", character: true },
  { id: "mickey", ro: "Mickey / Minnie", subject: "Mickey Mouse and Minnie Mouse", q: "Mickey Minnie Mouse", character: true },
  { id: "barbie", ro: "Barbie", subject: "Barbie", q: "Barbie", character: true },
  { id: "hellokitty", ro: "Hello Kitty", subject: "Hello Kitty", q: "Hello Kitty", character: true },
  { id: "pokemon", ro: "Pokémon", subject: "Pikachu and Pokemon", q: "Pokemon Pikachu", character: true },
  { id: "sonic", ro: "Sonic", subject: "Sonic the Hedgehog", q: "Sonic the Hedgehog", character: true },
  { id: "stitch", ro: "Stitch", subject: "Stitch from Lilo and Stitch", q: "Stitch Lilo", character: true },
  { id: "harrypotter", ro: "Harry Potter", subject: "Harry Potter", q: "Harry Potter", character: true },
];
export const STYLES = [
  { id: "real", ro: "Realist (ca o poză)", q: "realistic",
    prompts: ["cake toppers that are realistic photographs", "a realistic photo of an animal or person", "photographic pictures"] },
  { id: "cartoon", ro: "Desen / cartoon", q: "cute cartoon",
    prompts: ["cake toppers that are cute cartoon drawings", "a cartoon illustration", "cute clipart drawings"] },
];

// Several wordings per theme, averaged, guess better than one.
function prompts(item) {
  return item.prompts || [`a photo of ${item.subject}`, `a birthday cake decorated with ${item.subject}`, `${item.subject} cake toppers`];
}

export function searchWords(theme, styleId, custom) {
  const style = STYLES.find(s => s.id === styleId);
  if (custom) return `${style ? style.q + " " : ""}${custom} png`;
  if (!theme) return "";
  return theme.character ? `${theme.q} png` : `${style ? style.q + " " : ""}${theme.q} png`;
}
export function googleUrl(words) { return "https://www.google.com/search?tbm=isch&tbs=ic:trans&q=" + encodeURIComponent(words + " transparent background"); }
export function pinterestUrl(words) { return "https://www.pinterest.com/search/pins/?q=" + encodeURIComponent(words + " cake topper"); }

let tf = null, processor = null, vision = null;
async function loadTf() {
  if (tf) return;
  tf = await import(TF);
  tf.env.allowLocalModels = false;
  // One thread: with several, the library starts helper workers from the CDN, which the browser blocks.
  // One photo is quick enough this way.
  tf.env.backends.onnx.wasm.numThreads = 1;
}
async function load(onProgress) {
  await loadTf();
  if (!processor) processor = await tf.AutoProcessor.from_pretrained(MODEL);
  if (!vision) vision = await tf.CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: "q8", progress_callback: onProgress });
}

function normalize(v) { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return Float32Array.from(v, x => x / s); }
function fromB64(b64, dim) {
  const bin = atob(b64), out = [];
  for (let i = 0; i < bin.length; i += dim) {
    const v = new Float32Array(dim);
    for (let k = 0; k < dim; k++) { const b = bin.charCodeAt(i + k); v[k] = (b > 127 ? b - 256 : b) / 127; }
    out.push(normalize(v));
  }
  return out;
}
function probs(img, vecs) {
  const logits = vecs.map(v => { let d = 0; for (let k = 0; k < v.length; k++) d += v[k] * img[k]; return d * 100; });
  const m = Math.max(...logits), ex = logits.map(l => Math.exp(l - m)), sum = ex.reduce((a, b) => a + b, 0);
  return ex.map(e => e / sum);
}
function rank(sums, n, items) {
  return items.map((it, i) => ({ item: it, p: sums[i] / n })).sort((a, b) => b.p - a.p);
}

// The AI only sees a square cut from the middle of a picture, so a tall phone screenshot
// is looked at in overlapping squares from top to bottom, and the answers are averaged.
function squares(W, H) {
  const side = Math.min(W, H), long = Math.max(W, H), out = [];
  if (long < side * 1.15) return [[0, 0, W, H]];
  for (let p = 0; ; p += side / 2) {
    const at = Math.min(p, long - side);
    out.push(W < H ? [0, at, side, side] : [at, 0, side, side]);
    if (at >= long - side) break;
  }
  return out;
}

// Returns { themes: [{item, p}], styles: [{item, p}] } sorted best first.
export async function guess(file, onProgress) {
  const { default: V } = await import("./theme-vectors.js");
  await load(onProgress);
  const themeVecs = fromB64(V.themes, V.dim), styleVecs = fromB64(V.styles, V.dim);
  const bmp = await createImageBitmap(file);
  const tiles = squares(bmp.width, bmp.height);
  const tSum = new Array(THEMES.length).fill(0), sSum = new Array(STYLES.length).fill(0);
  for (const [x, y, w, h] of tiles) {
    const c = document.createElement("canvas");
    c.width = Math.round(w); c.height = Math.round(h);
    c.getContext("2d").drawImage(bmp, x, y, w, h, 0, 0, c.width, c.height);
    const image = await tf.RawImage.fromBlob(await new Promise(r => c.toBlob(r, "image/png")));
    const { image_embeds } = await vision(await processor(image));
    const img = normalize(image_embeds.data);
    probs(img, themeVecs).forEach((p, i) => tSum[i] += p);
    probs(img, styleVecs).forEach((p, i) => sSum[i] += p);
  }
  return { themes: rank(tSum, tiles.length, THEMES), styles: rank(sSum, tiles.length, STYLES) };
}

// Developer helper: re-run after changing THEMES or STYLES, and paste the result into theme-vectors.js.
export async function buildVectors() {
  await loadTf();
  const tok = await tf.AutoTokenizer.from_pretrained(MODEL);
  const text = await tf.CLIPTextModelWithProjection.from_pretrained(MODEL, { dtype: "q8" });
  const enc = async list => {
    let bin = "", dim = 0;
    for (const item of list) {
      const ps = prompts(item);
      const { text_embeds } = await text(tok(ps, { padding: true, truncation: true }));
      dim = text_embeds.dims[1];
      const avg = new Float32Array(dim);
      for (let r = 0; r < ps.length; r++) normalize(text_embeds.data.slice(r * dim, (r + 1) * dim)).forEach((x, k) => avg[k] += x);
      const v = normalize(avg);
      const mx = Math.max(...v.map(Math.abs)) || 1;
      for (const x of v) { const q = Math.round(x / mx * 127); bin += String.fromCharCode(q < 0 ? q + 256 : q); }
    }
    return { b64: btoa(bin), dim };
  };
  const t = await enc(THEMES), s = await enc(STYLES);
  return `// Generated by buildVectors() in theme.js for ${MODEL}. Do not edit by hand.\nexport default { dim: ${t.dim}, themes: "${t.b64}", styles: "${s.b64}" };\n`;
}
