import * as THREE from "three";

/** A texture painted once on a canvas. */
export function canvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** A soft radial falloff, used for glows, flashes, sparks, and contact shadows. */
export function radialTexture(inner: string, outer: string) {
  return canvasTexture(128, 128, (ctx) => {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, inner);
    gradient.addColorStop(1, outer);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  });
}

/** Deterministic noise in [0, 1), so procedural textures look the same on every load. */
export function seededRandom(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}
