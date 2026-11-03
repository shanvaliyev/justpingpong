import * as THREE from "three";

/**
 * Light falls on a surface in three flat bands with hard edges, like an anime colour script:
 * faces turned from the light (or in shadow) take only the ambient shade, faces just turning
 * towards it a mid-tone, and the rest full light. Texels cover dot(normal, light) from -1 to 1.
 */
const RAMP = new THREE.DataTexture(
  new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 120, 120, 120, 255, 255, 255, 255, 255, 255, 255]),
  20,
  1,
  THREE.RedFormat,
);
RAMP.minFilter = RAMP.magFilter = THREE.NearestFilter;
RAMP.needsUpdate = true;

/** A cel-shaded material; every lit surface in the game shares its light bands. */
export function toonMaterial(parameters: THREE.MeshToonMaterialParameters = {}) {
  return new THREE.MeshToonMaterial({ gradientMap: RAMP, ...parameters });
}
