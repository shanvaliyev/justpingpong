import type { Grade } from "./post";
import type { SceneryConfig } from "./scenery";

type Light = { color: number; intensity: number; position: [number, number, number] };
type Lighting = {
  sky: number;
  ground: number;
  ambient: number;
  /** The sun or moon: a far light that casts the main shadows. */
  key: Light;
  rim: Light;
  /** An optional floodlight that throws a pool of light, and its own shadows, over the table. */
  lamp?: Light & { angle: number };
  glow: number;
};

export const COURT_IDS = ["sakura", "seaside", "tokyo"] as const;
export type CourtId = (typeof COURT_IDS)[number];

type CourtConfig = {
  name: string;
  scenery: SceneryConfig;
  lighting: Lighting;
  /** Air between the camera and the edge of the court. */
  haze: { color: number; density: number };
  /** The court's colour script. */
  grade: Grade;
};

// Each court is a cel-shaded 3D floor and edge under an anime background painting of the distance.
// Lights follow the painting: Kyoto's sun is high on the left, Shonan's sets ahead on the right
// behind the table, and the Tokyo rooftop sits under a warm floodlight with the blue-hour city
// beyond. Cel shading has no reflected light, so the ambient light is stronger than a real
// scene's: it alone paints the shadow tone.
// index.html preloads the first court's images by id; keep its list in sync.
export const COURTS: Record<CourtId, CourtConfig> = {
  sakura: {
    name: "Kyoto sakura terrace",
    scenery: {
      backdrop: { horizon: 0.53, span: 84, pan: 0.1, boost: 0.15 },
      sky: { horizon: 0xc4ddf8, zenith: 0x287be5 },
      floor: { tile: 2, tint: 0xfff6ee },
      edge: { kind: "wall", distance: 6.5 },
      particles: { kind: "petals", color: 0xffffff, count: 160 },
    },
    lighting: {
      sky: 0xa9c8f5,
      ground: 0xc9b8a6,
      ambient: 1.6,
      // An afternoon sun from behind the left shoulder of the court: shadows towards the camera.
      key: { color: 0xfff1dc, intensity: 2.2, position: [-4.5, 3.4, -1.4] },
      rim: { color: 0xd0e4ff, intensity: 0.4, position: [2, 3, -5] },
      glow: 0.04,
    },
    haze: { color: 0xd7e8fb, density: 0.01 },
    grade: {
      bloom: 0.35,
      lift: [0, 0.01, 0.03],
      gain: [1.02, 1, 0.98],
      saturation: 1.15,
      contrast: 0.15,
    },
  },
  seaside: {
    name: "Shonan sunset boardwalk",
    scenery: {
      backdrop: { horizon: 0.535, span: 84, pan: 0.1, boost: 3 },
      sky: { horizon: 0xf08a50, zenith: 0x41487c },
      floor: { tile: 1.2, tint: 0xffffff },
      edge: { kind: "rail", distance: 6 },
      particles: { kind: "motes", color: 0xffd29a, count: 60 },
    },
    lighting: {
      sky: 0x8a7fd0,
      ground: 0xd09a78,
      ambient: 1.4,
      key: { color: 0xffb070, intensity: 2.6, position: [0.9, 1.7, -7.9] },
      rim: { color: 0xff9fb0, intensity: 0.5, position: [-2, 3, 5] },
      glow: 0.18,
    },
    haze: { color: 0xe7a988, density: 0.016 },
    grade: {
      bloom: 0.7,
      lift: [0.03, 0, 0.05],
      gain: [1.04, 0.99, 0.94],
      saturation: 1.12,
      contrast: 0.15,
    },
  },
  tokyo: {
    name: "Tokyo rooftop",
    scenery: {
      backdrop: { horizon: 0.52, span: 84, pan: -0.12, boost: 3 },
      sky: { horizon: 0x3a4a88, zenith: 0x1a3c82 },
      floor: { tile: 3, tint: 0xe8ecff },
      edge: { kind: "parapet", distance: 6.5 },
      particles: { kind: "motes", color: 0xcfe0ff, count: 40 },
    },
    lighting: {
      sky: 0x4a5cb0,
      ground: 0x3a3a50,
      ambient: 1.2,
      key: { color: 0x9db4ff, intensity: 0.5, position: [-1, 6, -2] },
      rim: { color: 0x8fa8ff, intensity: 0.8, position: [0, 2.5, -6] },
      lamp: { color: 0xffc890, intensity: 22, position: [-1.2, 5.2, 1.4], angle: 0.8 },
      glow: 0.3,
    },
    haze: { color: 0x1c2550, density: 0.025 },
    grade: {
      bloom: 0.9,
      lift: [0, 0.015, 0.05],
      gain: [1.03, 0.99, 0.96],
      saturation: 1.12,
      contrast: 0.15,
    },
  },
};
