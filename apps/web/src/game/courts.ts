import type { Grade } from "./post";
import type { SceneryConfig } from "./scenery";

type Light = { color: number; intensity: number; position: [number, number, number] };
type Lighting = {
  exposure: number;
  sky: number;
  ground: number;
  ambient: number;
  /** The sun or moon: a far light that casts the main shadows. */
  key: Light;
  rim: Light;
  /** An optional floodlight that throws a pool of light, and its own shadows, over the table. */
  lamp?: Light & { angle: number };
  environment: number;
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
  grade: Grade;
};

// Each court is a real 3D floor and edge under a lens-blurred photo of the distance. Lights follow
// the photo: Kyoto's sun is high on the left, Shonan's sets ahead on the right behind the table, and
// the Tokyo rooftop sits under a warm floodlight with the blue-hour city beyond.
// index.html preloads the first court's images by id; keep its list in sync.
export const COURTS: Record<CourtId, CourtConfig> = {
  sakura: {
    name: "Kyoto sakura terrace",
    scenery: {
      backdrop: { horizon: 0.5, span: 84, pan: 0.1, boost: 0.6 },
      sky: { horizon: 0xd7e6f2, zenith: 0x76afe4 },
      floor: { tile: 2, tint: 0xd8d2ca, bumps: 0.8 },
      edge: { kind: "wall", distance: 6.5 },
      particles: { kind: "petals", color: 0xffc8d8, count: 160 },
    },
    lighting: {
      exposure: 0.9,
      sky: 0xbcd6f5,
      ground: 0xb9ab9a,
      ambient: 0.45,
      // A low afternoon sun from behind the left shoulder of the court: long shadows towards the
      // camera and a sheen across the table.
      key: { color: 0xffdfb8, intensity: 3.3, position: [-4.5, 3.4, -1.4] },
      rim: { color: 0xd0e4ff, intensity: 0.6, position: [2, 3, -5] },
      environment: 0.9,
      glow: 0.06,
    },
    haze: { color: 0xdde6f0, density: 0.012 },
    grade: {
      bloom: 0.5,
      lift: [0, 0.008, 0.02],
      gain: [1.03, 1, 0.97],
      saturation: 1.1,
      contrast: 0.4,
    },
  },
  seaside: {
    name: "Shonan sunset boardwalk",
    scenery: {
      backdrop: { horizon: 0.58, span: 84, pan: 0.1, boost: 5 },
      sky: { horizon: 0xf0a070, zenith: 0x3c4f77 },
      floor: { tile: 1.2, tint: 0xffffff, bumps: 1 },
      edge: { kind: "rail", distance: 6 },
      particles: { kind: "motes", color: 0xffd29a, count: 60 },
    },
    lighting: {
      exposure: 1,
      sky: 0x8f8fc8,
      ground: 0xc89a78,
      ambient: 0.45,
      key: { color: 0xffb470, intensity: 3.5, position: [0.9, 1.7, -7.9] },
      rim: { color: 0xff9fb0, intensity: 0.5, position: [-2, 3, 5] },
      environment: 1,
      glow: 0.18,
    },
    haze: { color: 0xe7a988, density: 0.02 },
    grade: {
      bloom: 0.9,
      lift: [0.025, 0, 0.035],
      gain: [1.05, 0.99, 0.92],
      saturation: 1.08,
      contrast: 0.3,
    },
  },
  tokyo: {
    name: "Tokyo rooftop",
    scenery: {
      backdrop: { horizon: 0.39, span: 84, pan: -0.12, boost: 4 },
      sky: { horizon: 0x2a4f95, zenith: 0x11509e },
      floor: { tile: 3, tint: 0xffffff, bumps: 0.8 },
      edge: { kind: "parapet", distance: 6.5 },
      particles: { kind: "motes", color: 0xcfe0ff, count: 40 },
    },
    lighting: {
      exposure: 1,
      sky: 0x3a4c9a,
      ground: 0x30303e,
      ambient: 0.35,
      key: { color: 0x9db4ff, intensity: 0.5, position: [-1, 6, -2] },
      rim: { color: 0x8fa8ff, intensity: 1, position: [0, 2.5, -6] },
      lamp: { color: 0xffc890, intensity: 28, position: [-1.2, 5.2, 1.4], angle: 0.8 },
      environment: 0.9,
      glow: 0.35,
    },
    haze: { color: 0x1c2550, density: 0.03 },
    grade: {
      bloom: 1.1,
      lift: [0, 0.01, 0.04],
      gain: [1.03, 0.98, 0.95],
      saturation: 1.05,
      contrast: 0.3,
    },
  },
};
