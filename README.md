# Toppere A4

A phone web app that turns screenshots (Pinterest, pictures from family) into a print-ready A4 sheet of cake toppers.

1. Pick one or more screenshots. The app finds each picture, cuts it out and removes the background, all on the phone.
2. Tap a cut-out to put a copy on the sheet (as many times as wanted); ✕ removes it from the list.
3. On the sheet: drag to move; tap a topper to select it, then the pink corner dot resizes it and ✕ deletes it. Toppers that touch turn red.
   "Umple automat" fills rows × columns (default 4 × 4); with fewer pictures than slots they repeat, mixed so the same one isn't side by side.
4. Share or save the PNG: exactly A4 at 300 DPI, white sticker outline around each picture.

Optional first step, **Caută modele**: pick a photo of a cake and an on-phone AI (CLIP) guesses the theme (from a fixed list) and the style (realistic or cartoon). She can correct it or type her own theme, then the app opens Google Images (transparent backgrounds) or Pinterest with English search words. She saves the pictures she likes and picks them at step 1.

## Files
- `index.html`: the page (Romanian UI).
- `app.js`: finding, cutting out and laying out the pictures.
- `theme.js`: theme guessing from a cake photo, the theme list, and the search links.
- `theme-vectors.js`: the theme list pre-computed for the AI. Regenerate it with `buildVectors()` in `theme.js` whenever the list changes.
- `sw.js`: service worker that lets the cut-out use several processor cores (about 2× faster).

The background removal is [@imgly/background-removal](https://github.com/imgly/background-removal-js), loaded from esm.sh. Its AI model (about 40 MB) downloads on first use. Pictures never leave the phone.

Hosted on GitHub Pages. No build step: the files are served as they are.
