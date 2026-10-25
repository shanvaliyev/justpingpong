import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the declared DotGothic16 slices cover every character the game's text uses", () => {
  const ranges = [...read("../src/game/fonts.css").matchAll(/unicode-range:([^;]+);/g)].flatMap(
    ([, list]) =>
      list.split(",").map((part) => {
        const [low, high = low] = part.trim().replace(/^U\+/i, "").split("-");
        return [parseInt(low, 16), parseInt(high, 16)];
      }),
  );
  // The card, brand, and court names are written in these files.
  const text = read("../src/game/practice-game.tsx") + read("../src/game/court.ts");
  const missing = [...new Set(text)].filter((character) => {
    const code = character.codePointAt(0);
    return code >= 0x20 && !ranges.some(([low, high]) => low <= code && code <= high);
  });
  assert.deepEqual(missing, [], "add the @fontsource/dotgothic16 slices for these to fonts.css");
});
