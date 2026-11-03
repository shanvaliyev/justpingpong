import * as THREE from "three";

import {
  BloomEffect,
  Effect,
  EffectAttribute,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
} from "postprocessing";

type Rgb = [number, number, number];
/**
 * A court's colour script. `lift` tints the shadows and `gain` the highlights (both in display
 * space); `contrast` blends towards an S-curve; `bloom` scales the glow around bright light.
 */
export type Grade = {
  bloom: number;
  lift: Rgb;
  gain: Rgb;
  saturation: number;
  contrast: number;
};

const gradeShader = /* glsl */ `
uniform vec3 lift;
uniform vec3 gain;
uniform float saturation;
uniform float contrast;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 colour = pow(max(inputColor.rgb, 0.0), vec3(1.0 / 2.2));
  colour = mix(colour, colour * colour * (3.0 - 2.0 * colour), contrast);
  colour = colour * gain + lift * (1.0 - colour);
  float grey = dot(colour, vec3(0.2126, 0.7152, 0.0722));
  colour = mix(vec3(grey), colour, saturation);
  outputColor = vec4(pow(max(colour, 0.0), vec3(2.2)), inputColor.a);
}`;

/**
 * Ink lines, found in the depth buffer: silhouettes where a neighbouring pixel lies well behind
 * this one, and creases where two faces meet. 1/z changes linearly across any flat face, so its
 * second difference is zero except at a crease. Lines fade out with distance so the far court
 * stays soft, like background art behind inked characters.
 */
const inkShader = /* glsl */ `
uniform vec3 ink;
uniform float width;
uniform float reach;

float inverseDepth(const in vec2 uv) {
  return -1.0 / getViewZ(readDepth(uv));
}

float edge(const in vec2 uv, const in vec2 offset, const in float w) {
  float l = inverseDepth(uv - vec2(offset.x, 0.0));
  float r = inverseDepth(uv + vec2(offset.x, 0.0));
  float d = inverseDepth(uv - vec2(0.0, offset.y));
  float u = inverseDepth(uv + vec2(0.0, offset.y));
  // Only the nearer side of a silhouette is inked, so a line hugs the object in front.
  float behind = max(max(w - l, w - r), max(w - d, w - u)) / w;
  float crease = max(abs(l + r - 2.0 * w), abs(d + u - 2.0 * w)) / w;
  return max(smoothstep(0.05, 0.1, behind), smoothstep(0.012, 0.03, crease));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  outputColor = inputColor;
  float z = -getViewZ(depth);
  if (z > reach) return;
  // Line width scales with the screen, so phones and desktops draw the same weight of line.
  vec2 offset = texelSize * width * max(1.0, resolution.y / 720.0);
  float w = 1.0 / z;
  // Two widths averaged give the line a soft, antialiased edge.
  float line = 0.5 * (edge(uv, offset, w) + edge(uv, offset * 0.5, w));
  line *= 1.0 - smoothstep(reach * 0.6, reach, z);
  outputColor.rgb = mix(inputColor.rgb, ink, line);
}`;

/**
 * Sports-anime drama for big hits: focus lines rushing in from the edges of the frame towards the
 * hit, redrawn on twos like hand animation, and an impact frame that flashes the picture to
 * two-tone ink and paper for an instant.
 */
const mangaShader = /* glsl */ `
uniform vec2 focus;
uniform float lines;
uniform float flash;
uniform vec3 ink;
uniform vec3 paper;

float hash(const in float n) {
  return fract(sin(n) * 43758.5453);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 colour = inputColor.rgb;
  if (lines > 0.0) {
    vec2 p = (uv - focus) * vec2(aspect, 1.0);
    float slots = 110.0;
    float turn = atan(p.y, p.x) / 6.2831853 * slots;
    float slot = floor(turn);
    float frame = floor(time * 12.0);
    float seed = slot * 7.13 + frame * 31.7;
    float radius = length(p);
    float start = 0.32 + hash(seed) * 0.3 + (1.0 - lines) * 0.5;
    // Each wedge tapers to a point at its inner end.
    float thickness = (0.1 + 0.3 * hash(seed + 1.0)) * smoothstep(start, start + 0.35, radius);
    float wedge = 1.0 - smoothstep(thickness - 0.08, thickness, abs(fract(turn) - 0.5));
    wedge *= step(0.35, hash(seed + 2.0));
    colour = mix(colour, paper, wedge * min(1.0, lines * 1.5) * 0.9);
  }
  if (flash > 0.0) {
    float light = dot(colour, vec3(0.2126, 0.7152, 0.0722));
    vec3 tone = mix(ink, paper, smoothstep(0.16, 0.2, light));
    colour = mix(colour, tone, flash);
  }
  outputColor = vec4(colour, inputColor.a);
}`;

/** Ink and paper colours, in linear light. */
const INK = new THREE.Color(0x15102e);
const PAPER = new THREE.Color(0xfff8e8);

/**
 * Renders the scene in high dynamic range and finishes it like an anime frame in one pass: bloom,
 * neutral tone mapping that keeps colours clean, the court's colour script, ink outlines, and
 * the focus lines and impact frames of big hits.
 */
export function createPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
) {
  const hdr =
    renderer.extensions.has("EXT_color_buffer_float") ||
    renderer.extensions.has("EXT_color_buffer_half_float");
  const composer = new EffectComposer(renderer, {
    frameBufferType: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    multisampling: Math.min(4, renderer.capabilities.maxSamples),
  });
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new BloomEffect({
    mipmapBlur: true,
    luminanceThreshold: 0.9,
    luminanceSmoothing: 0.3,
    radius: 0.6,
  });
  const uniforms = {
    lift: new THREE.Uniform(new THREE.Vector3()),
    gain: new THREE.Uniform(new THREE.Vector3(1, 1, 1)),
    saturation: new THREE.Uniform(1),
    contrast: new THREE.Uniform(0),
  };
  const grade = new Effect("Grade", gradeShader, {
    uniforms: new Map<string, THREE.Uniform>(Object.entries(uniforms)),
  });
  const ink = new Effect("Ink", inkShader, {
    attributes: EffectAttribute.DEPTH,
    uniforms: new Map<string, THREE.Uniform>([
      ["ink", new THREE.Uniform(INK)],
      // Line width in pixels of a 720-pixel-tall frame.
      ["width", new THREE.Uniform(2.2)],
      // Metres from the camera beyond which nothing is inked.
      ["reach", new THREE.Uniform(9)],
    ]),
  });
  const drama = {
    focus: new THREE.Uniform(new THREE.Vector2(0.5, 0.5)),
    lines: new THREE.Uniform(0),
    flash: new THREE.Uniform(0),
  };
  const manga = new Effect("Manga", mangaShader, {
    uniforms: new Map<string, THREE.Uniform>([
      ...Object.entries(drama),
      ["ink", new THREE.Uniform(INK)],
      ["paper", new THREE.Uniform(PAPER)],
    ]),
  });
  composer.addPass(
    new EffectPass(
      camera,
      bloom,
      new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }),
      grade,
      ink,
      manga,
    ),
  );

  return {
    setGrade(look: Grade) {
      bloom.intensity = look.bloom;
      uniforms.lift.value.set(...look.lift);
      uniforms.gain.value.set(...look.gain);
      uniforms.saturation.value = look.saturation;
      uniforms.contrast.value = look.contrast;
    },
    /**
     * Focus lines towards `focus` (screen UV) at `lines` strength, and an impact frame at `flash`
     * strength; both 0–1, and 0 for neither.
     */
    setDrama(focus: THREE.Vector2, lines: number, flash: number) {
      drama.focus.value.copy(focus);
      drama.lines.value = lines;
      drama.flash.value = flash;
    },
    /**
     * Compile `object`'s shaders for the HDR buffer every frame is drawn into. Shaders compiled for
     * the canvas would be a different, unused variant, and the real ones would then compile while
     * drawing.
     */
    compile(object: THREE.Object3D, target?: THREE.Scene) {
      const current = renderer.getRenderTarget();
      renderer.setRenderTarget(composer.inputBuffer);
      const compiled = renderer.compileAsync(object, camera, target);
      renderer.setRenderTarget(current);
      return compiled;
    },
    /**
     * The first step down for slow devices: multisampling is the costliest part of the pass, and
     * at a high pixel ratio it adds the least sharpness. False once it is already off.
     */
    stopAntialiasing() {
      if (composer.multisampling === 0) return false;
      composer.multisampling = 0;
      return true;
    },
    setSize(width: number, height: number) {
      composer.setSize(width, height);
    },
    render(dt: number) {
      composer.render(dt);
    },
    dispose() {
      composer.dispose();
    },
  };
}
