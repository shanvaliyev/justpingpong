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

/**
 * A tiling normal map of fine random bumps, such as rubber pores or a lacquer's orange peel.
 * Larger `strength` gives steeper bumps.
 */
export function grainNormalTexture(size: number, strength: number, seed: number) {
  const rand = seededRandom(seed);
  let height = Float32Array.from({ length: size * size }, rand);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  // Two wrapping box blurs turn white noise into soft bumps that tile seamlessly.
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) sum += at(x + dx, y + dy);
        }
        next[y * size + x] = sum / 9;
      }
    }
    height = next;
  }
  const texture = canvasTexture(size, size, (ctx) => {
    const image = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Canvas rows run down while texture v runs up, hence the sign of ny.
        const nx = -(at(x + 1, y) - at(x - 1, y)) * strength;
        const ny = (at(x, y + 1) - at(x, y - 1)) * strength;
        const length = Math.hypot(nx, ny, 1);
        const i = (y * size + x) * 4;
        image.data[i] = (nx / length) * 127.5 + 127.5;
        image.data[i + 1] = (ny / length) * 127.5 + 127.5;
        image.data[i + 2] = (1 / length) * 127.5 + 127.5;
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  });
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** Deterministic noise in [0, 1), so procedural textures look the same on every load. */
export function seededRandom(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}
