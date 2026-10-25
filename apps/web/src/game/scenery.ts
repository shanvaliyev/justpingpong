import * as THREE from "three";

import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

import { COURTS, type CourtId } from "./courts";
import { canvasTexture, radialTexture, seededRandom } from "./textures";

/** The ground under the table; the table top is y = 0. */
export const FLOOR_Y = -0.76;
// The backdrop photo hangs far beyond the court with its horizon at eye height, so the real 3D
// floor meets it in perspective from every camera. Cameras sit within ~15 cm of EYE_HEIGHT, a
// tenth of a degree at this distance.
const BACKDROP_DISTANCE = 90;
const EYE_HEIGHT = 1.45;
const FLOOR_WIDTH = 60;
const FLOOR_NEAR = 25;

export type SceneryConfig = {
  /**
   * The distant view: a photo blurred as if the lens were focused on the table. `horizon` is the
   * horizon's height from the photo's top (0–1), `span` the horizontal angle it covers in degrees,
   * `pan` how far right of the photo's centre the view looks (fraction of its width), and `boost`
   * how far its brightest parts (sun, lamps, glitter) are lifted above white to bloom.
   */
  backdrop: { horizon: number; span: number; pan: number; boost: number };
  /** Sky colours above and beside the photo. */
  sky: { horizon: number; zenith: number };
  /** Metres one floor texture covers, its colour tint, and its bump strength. */
  floor: { tile: number; tint: number; bumps: number };
  /** What closes the court off from the view, this many metres beyond the net. */
  edge: { kind: "wall" | "rail" | "parapet"; distance: number };
  particles: { kind: "petals" | "motes"; color: number; count: number };
};

/** Every image a court needs; index.html preloads the first court's. */
export const courtImages = (id: CourtId) => ({
  backdrop: `/game/courts/${id}-backdrop.webp`,
  floor: `/game/courts/${id}-floor.webp`,
  normal: `/game/courts/${id}-floor-normal.webp`,
  rough: `/game/courts/${id}-floor-rough.webp`,
});

/** Decode an image off the main thread; same-origin, so it shares the page's preload. */
async function loadTexture(src: string, colour: boolean) {
  const image = new Image();
  image.src = src;
  await image.decode();
  const texture = new THREE.Texture(image);
  texture.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

type FloorMaps = { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture };

/** The floor maps again, repeated `x` by `y` times; clones share the uploaded images. */
function repeated(maps: FloorMaps, x: number, y: number): FloorMaps {
  const copy = (texture: THREE.Texture) => {
    const clone = texture.clone();
    clone.repeat.set(x, y);
    return clone;
  };
  return {
    map: copy(maps.map),
    normalMap: copy(maps.normalMap),
    roughnessMap: copy(maps.roughnessMap),
  };
}

/** A textured stone, wood, or concrete surface whose tonal drift hides the texture's repeat. */
function surfaceMaterial(maps: FloorMaps, tint: number, bumps: number) {
  const material = new THREE.MeshStandardMaterial({
    ...maps,
    color: tint,
    normalScale: new THREE.Vector2(bumps, bumps),
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "void main() {",
        /* glsl */ `
        float macroHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float macroNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(macroHash(i), macroHash(i + vec2(1.0, 0.0)), f.x),
            mix(macroHash(i + vec2(0.0, 1.0)), macroHash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }
        void main() {`,
      )
      .replace(
        "#include <map_fragment>",
        /* glsl */ `#include <map_fragment>
        float macro = macroNoise(vMapUv * 0.37) * 0.65 + macroNoise(vMapUv * 1.1 + 7.1) * 0.35;
        diffuseColor.rgb *= mix(0.82, 1.12, macro);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * mix(0.85, 1.15, macro), 0.04, 1.0);`,
      );
  };
  return material;
}

function skyMaterial(sky: SceneryConfig["sky"]) {
  return new THREE.ShaderMaterial({
    uniforms: {
      horizon: { value: new THREE.Color(sky.horizon) },
      zenith: { value: new THREE.Color(sky.zenith) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 horizon;
      uniform vec3 zenith;
      varying vec3 vDirection;
      void main() {
        float up = normalize(vDirection).y;
        gl_FragColor = vec4(mix(horizon, zenith, smoothstep(0.0, 0.5, up)), 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

function backdropMaterial(map: THREE.Texture, boost: number) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, boost: { value: boost } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float boost;
      varying vec2 vUv;
      void main() {
        vec3 colour = texture2D(map, vUv).rgb;
        // The photo stops at white; lift its brightest parts past it so they bloom like real light.
        float light = dot(colour, vec3(0.2126, 0.7152, 0.0722));
        colour *= 1.0 + boost * pow(smoothstep(0.55, 1.0, light), 3.0);
        gl_FragColor = vec4(colour, 1.0);
      }`,
    depthWrite: false,
  });
}

/**
 * The photo on a far plane whose horizon row sits at eye height. Beyond the photo's sides the
 * plane mirrors it, and above it the top row stretches into the sky, for very wide screens.
 */
function createBackdrop(map: THREE.Texture, config: SceneryConfig["backdrop"]) {
  const { width: pixels, height: rows } = map.image as HTMLImageElement;
  const width = 2 * (BACKDROP_DISTANCE + 4) * Math.tan(THREE.MathUtils.degToRad(config.span / 2));
  const height = (width * rows) / pixels;
  const [u0, u1, v0, v1] = [-0.4, 1.4, -0.25, 1.35];
  const geometry = new THREE.PlaneGeometry(width * (u1 - u0), height * (v1 - v0));
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, config.pan + u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
  map.wrapS = THREE.MirroredRepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  const mesh = new THREE.Mesh(geometry, backdropMaterial(map, config.boost));
  const horizonV = 1 - config.horizon;
  mesh.position.set(
    0,
    EYE_HEIGHT - ((horizonV - v0) / (v1 - v0) - 0.5) * height * (v1 - v0),
    -BACKDROP_DISTANCE,
  );
  mesh.renderOrder = -1;
  return mesh;
}

/** A railing or wall along the far end of the floor. Everything casts and takes shadows. */
function createEdge(maps: FloorMaps, { edge, floor }: SceneryConfig) {
  const group = new THREE.Group();
  const z = -edge.distance;
  const add = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: [number, number, number],
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const posts = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    spacing: number,
    y: number,
  ) => {
    const count = Math.floor(FLOOR_WIDTH / spacing);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      mesh.setMatrixAt(i, matrix.makeTranslation((i - (count - 1) / 2) * spacing, y, z));
    }
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  };
  const rail = (radius: number, height: number, material: THREE.Material) => {
    const mesh = add(new THREE.CylinderGeometry(radius, radius, FLOOR_WIDTH, 12), material, [
      0,
      FLOOR_Y + height,
      z,
    ]);
    mesh.rotation.z = Math.PI / 2;
  };
  /** The floor's textures on a strip as long as the floor and `height` tall, tinted by `shade`. */
  const surface = (height: number, shade = 1) =>
    surfaceMaterial(
      repeated(maps, FLOOR_WIDTH / floor.tile, height / floor.tile),
      new THREE.Color(floor.tint).multiplyScalar(shade).getHex(),
      floor.bumps,
    );

  if (edge.kind === "wall") {
    // A low dressed-stone wall with a darker capstone.
    const height = 0.6;
    add(new RoundedBoxGeometry(FLOOR_WIDTH, height, 0.4, 2, 0.03), surface(height), [
      0,
      FLOOR_Y + height / 2,
      z - 0.2,
    ]);
    add(new RoundedBoxGeometry(FLOOR_WIDTH, 0.08, 0.5, 2, 0.02), surface(0.5, 0.72), [
      0,
      FLOOR_Y + height + 0.04,
      z - 0.2,
    ]);
  } else if (edge.kind === "rail") {
    // A white seafront railing: square posts and round rails, open to the sea below.
    const paint = new THREE.MeshStandardMaterial({
      color: 0xf1eee6,
      roughness: 0.42,
      metalness: 0.15,
    });
    posts(new RoundedBoxGeometry(0.07, 1.04, 0.07, 2, 0.015), paint, 1.6, FLOOR_Y + 0.52);
    rail(0.036, 1.04, paint);
    rail(0.014, 0.72, paint);
    rail(0.014, 0.4, paint);
  } else {
    // A concrete parapet with a glass balustrade, a steel handrail, and a warm LED strip.
    const height = 0.5;
    add(new RoundedBoxGeometry(FLOOR_WIDTH, height, 0.3, 2, 0.02), surface(height, 1.1), [
      0,
      FLOOR_Y + height / 2,
      z - 0.15,
    ]);
    const steel = new THREE.MeshStandardMaterial({
      color: 0x3a3f48,
      roughness: 0.3,
      metalness: 0.85,
    });
    posts(new THREE.BoxGeometry(0.035, 0.66, 0.035), steel, 1.5, FLOOR_Y + height + 0.33);
    rail(0.03, height + 0.66, steel);
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(FLOOR_WIDTH, 0.62),
      new THREE.MeshPhysicalMaterial({
        color: 0xa8c4d8,
        roughness: 0.04,
        transparent: true,
        opacity: 0.16,
        envMapIntensity: 1.6,
        depthWrite: false,
      }),
    );
    glass.position.set(0, FLOOR_Y + height + 0.32, z - 0.15);
    group.add(glass);
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(FLOOR_WIDTH, 0.018, 0.01),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb46a).multiplyScalar(5) }),
    );
    strip.position.set(0, FLOOR_Y + 0.06, z + 0.006);
    group.add(strip);
  }
  return group;
}

const PARTICLE_BOX = { x: 3.6, bottom: FLOOR_Y, top: 2.6, far: -6, near: 3.8 };

/** Cherry petals tumbling down through the court on a light breeze. */
function createPetals(count: number, colour: number) {
  const map = canvasTexture(64, 64, (ctx) => {
    const gradient = ctx.createLinearGradient(0, 64, 0, 0);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(1, "#ffd6e2");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(32, 62);
    ctx.bezierCurveTo(2, 40, 8, 6, 26, 4);
    ctx.lineTo(32, 12);
    ctx.lineTo(38, 4);
    ctx.bezierCurveTo(56, 6, 62, 40, 32, 62);
    ctx.fill();
  });
  const material = new THREE.MeshStandardMaterial({
    map,
    color: colour,
    emissive: colour,
    emissiveIntensity: 0.25,
    roughness: 0.7,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.024, 0.024), material, count);
  mesh.frustumCulled = false;
  const rand = seededRandom(4242);
  const range = (min: number, max: number) => min + rand() * (max - min);
  const petals = Array.from({ length: count }, () => ({
    position: new THREE.Vector3(
      range(-PARTICLE_BOX.x, PARTICLE_BOX.x),
      range(PARTICLE_BOX.bottom, PARTICLE_BOX.top),
      range(PARTICLE_BOX.far, PARTICLE_BOX.near),
    ),
    fall: range(0.22, 0.42),
    sway: range(0.08, 0.2),
    phase: range(0, Math.PI * 2),
    axis: new THREE.Vector3(range(-1, 1), range(-1, 1), range(-1, 1)).normalize(),
    spin: range(2, 5),
  }));
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const matrix = new THREE.Matrix4();
  return {
    object: mesh,
    update(dt: number, time: number) {
      petals.forEach((petal, i) => {
        const p = petal.position;
        p.y -= petal.fall * dt;
        p.x += (0.18 + Math.sin(time * 1.3 + petal.phase) * petal.sway) * dt;
        p.z += Math.cos(time * 0.9 + petal.phase) * petal.sway * 0.5 * dt;
        if (p.y < PARTICLE_BOX.bottom) {
          p.set(
            range(-PARTICLE_BOX.x, PARTICLE_BOX.x),
            PARTICLE_BOX.top,
            range(PARTICLE_BOX.far, PARTICLE_BOX.near),
          );
        }
        if (p.x > PARTICLE_BOX.x) p.x -= PARTICLE_BOX.x * 2;
        rotation.setFromAxisAngle(petal.axis, time * petal.spin + petal.phase);
        mesh.setMatrixAt(i, matrix.compose(p, rotation, scale));
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

/** Specks of dust catching the light, drifting and twinkling. */
function createMotes(count: number, colour: number) {
  const rand = seededRandom(977);
  const range = (min: number, max: number) => min + rand() * (max - min);
  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  const motes = Array.from({ length: count }, () => ({
    origin: new THREE.Vector3(range(-3, 3), range(-0.6, 2.2), range(-5, 3)),
    phase: range(0, Math.PI * 2),
    speed: range(0.2, 0.5),
  }));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute(
    "color",
    new THREE.BufferAttribute(colours, 3).setUsage(THREE.DynamicDrawUsage),
  );
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 0.016,
      map: radialTexture("rgba(255,255,255,1)", "rgba(255,255,255,0)"),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  points.frustumCulled = false;
  const tint = new THREE.Color(colour);
  return {
    object: points,
    update(_dt: number, time: number) {
      motes.forEach((mote, i) => {
        const t = time * mote.speed + mote.phase;
        positions[i * 3] = mote.origin.x + Math.sin(t * 0.7) * 0.4;
        positions[i * 3 + 1] = mote.origin.y + Math.sin(t * 0.5 + 1) * 0.25;
        positions[i * 3 + 2] = mote.origin.z + Math.cos(t * 0.6) * 0.4;
        // Bright enough at its peak to bloom, as dust does when it crosses a sunbeam.
        const glint = Math.max(0, Math.sin(t * 2.3)) ** 6 * 3 + 0.25;
        colours.set([tint.r * glint, tint.g * glint, tint.b * glint], i * 3);
      });
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
    },
  };
}

export type Scenery = Awaited<ReturnType<typeof loadScenery>>;

/**
 * Everything around the table for one court: sky, backdrop, floor, edge, and particles, plus the
 * reflections they cast, built from the same sky, photo, and ground.
 */
export async function loadScenery(
  id: CourtId,
  renderer: THREE.WebGLRenderer,
  pmrem: THREE.PMREMGenerator,
) {
  const { scenery: config, lighting } = COURTS[id];
  const images = courtImages(id);
  const [backdropMap, map, normalMap, roughnessMap] = await Promise.all([
    loadTexture(images.backdrop, true),
    loadTexture(images.floor, true),
    loadTexture(images.normal, false),
    loadTexture(images.rough, false),
  ]);
  const anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  for (const texture of [map, normalMap, roughnessMap]) texture.anisotropy = anisotropy;
  const maps = { map, normalMap, roughnessMap };

  const object = new THREE.Group();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), skyMaterial(config.sky));
  sky.renderOrder = -2;
  const backdrop = createBackdrop(backdropMap, config.backdrop);

  const length = config.edge.distance + FLOOR_NEAR;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(FLOOR_WIDTH, length),
    surfaceMaterial(
      repeated(maps, FLOOR_WIDTH / config.floor.tile, length / config.floor.tile),
      config.floor.tint,
      config.floor.bumps,
    ),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, FLOOR_Y, (FLOOR_NEAR - config.edge.distance) / 2);
  floor.receiveShadow = true;

  const particles =
    config.particles.kind === "petals"
      ? createPetals(config.particles.count, config.particles.color)
      : createMotes(config.particles.count, config.particles.color);
  object.add(sky, backdrop, floor, createEdge(maps, config), particles.object);
  // Upload the photos now, once their sampling is final, rather than in the first frame that
  // shows this court. The wall's copies of the floor maps reuse these uploads.
  const { map: floorMap, normalMap: floorNormal, roughnessMap: floorRough } = floor.material;
  for (const texture of [backdropMap, floorMap!, floorNormal!, floorRough!]) {
    renderer.initTexture(texture);
  }

  // Reflections and ambient light come from the same sky and photo, over the ground's colour.
  const reflected = new THREE.Scene();
  const groundDisc = new THREE.Mesh(
    new THREE.CircleGeometry(60, 32),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(lighting.ground).multiplyScalar(0.5) }),
  );
  groundDisc.rotation.x = -Math.PI / 2;
  groundDisc.position.y = FLOOR_Y;
  reflected.add(sky.clone(), backdrop.clone(), groundDisc);
  const environment = pmrem.fromScene(reflected, 0.02, 0.1, 400, {
    position: new THREE.Vector3(0, 0.3, 0),
  }).texture;
  groundDisc.geometry.dispose();
  groundDisc.material.dispose();

  return {
    object,
    environment,
    update: particles.update,
    dispose() {
      environment.dispose();
      backdropMap.dispose();
    },
  };
}
