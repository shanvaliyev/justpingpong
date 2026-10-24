import type { CSSProperties } from "react";

/** Arcade sprites: one string per row, "#" marks a lit pixel. */
const SPRITES = {
  help: [
    ".######.",
    "##....##",
    "##....##",
    "....###.",
    "...##...",
    "...##...",
    "........",
    "...##...",
  ],
  pause: ["##...##", "##...##", "##...##", "##...##", "##...##", "##...##", "##...##", "##...##"],
  play: [
    "##......",
    "####....",
    "######..",
    "########",
    "########",
    "######..",
    "####....",
    "##......",
  ],
  restart: [
    "..#.####..",
    "..###..##.",
    "..####..##",
    "........##",
    "##......##",
    "##......##",
    "##......##",
    ".##....##.",
    "..######..",
    "...####...",
  ],
  sound: [
    "...#.....",
    "..##...#.",
    "####.#..#",
    "####..#.#",
    "####..#.#",
    "####.#..#",
    "..##...#.",
    "...#.....",
  ],
  mute: [
    "...#.....",
    "..##.....",
    "####.#..#",
    "####..##.",
    "####..##.",
    "####.#..#",
    "..##.....",
    "...#.....",
  ],
  move: [
    "....#....",
    "...###...",
    "..#.#.#..",
    ".#..#..#.",
    "#########",
    ".#..#..#.",
    "..#.#.#..",
    "...###...",
    "....#....",
  ],
  flick: [
    "..######",
    ".....###",
    "....####",
    "...###.#",
    "..###...",
    ".###....",
    "###.....",
    "##......",
  ],
  paddle: [
    ".####...",
    "######..",
    "######..",
    "######..",
    ".####...",
    "....##..",
    ".....##.",
    "......##",
  ],
  sakura: [
    "...#.#...",
    "..#####..",
    "#..###..#",
    "##.###.##",
    "####.####",
    ".##...##.",
    "..##.##..",
    ".###.###.",
    ".##...##.",
  ],
};

export type PixelIconName = keyof typeof SPRITES;

const ICONS = Object.fromEntries(
  Object.entries(SPRITES).map(([name, rows]) => [
    name,
    {
      width: rows[0].length,
      height: rows.length,
      path: rows
        .flatMap((row, y) =>
          [...row].map((pixel, x) => (pixel === "#" ? `M${x} ${y}h1v1h-1z` : "")),
        )
        .join(""),
    },
  ]),
) as Record<PixelIconName, { width: number; height: number; path: string }>;

/** Draws a sprite at a whole number of screen pixels per sprite pixel, set by the CSS `--dot` size. */
export function PixelIcon({ name }: { name: PixelIconName }) {
  const { width, height, path } = ICONS[name];
  return (
    <svg
      className="pixel-icon"
      viewBox={`0 0 ${width} ${height}`}
      style={{ "--w": width, "--h": height } as CSSProperties}
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}
