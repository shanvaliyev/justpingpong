import * as THREE from "three";

import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from "postprocessing";

type Rgb = [number, number, number];
/**
 * A court's camera look. `lift` tints the shadows and `gain` the highlights (both in display
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
 * Renders the scene in high dynamic range and finishes it like a film camera in one pass: bloom,
 * filmic tone mapping, the court's grade, a lens vignette, and fine grain.
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
    radius: 0.75,
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
  const grain = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.ADD });
  grain.blendMode.opacity.value = 0.12;
  composer.addPass(
    new EffectPass(
      camera,
      bloom,
      new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
      grade,
      new VignetteEffect({ offset: 0.3, darkness: 0.5 }),
      grain,
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
    /** The last step down for slow devices: multisampling is the costliest part of the pass. */
    stopAntialiasing() {
      composer.multisampling = 0;
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
