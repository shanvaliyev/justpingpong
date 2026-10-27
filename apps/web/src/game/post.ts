import * as THREE from "three";

import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectAttribute,
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
 * Depth of field beyond the court: the lens is focused on the table, so the far floor and the
 * wall or railing soften like the photo behind them. Taps on sharp, nearer things are skipped, so
 * the table and rackets keep crisp silhouettes instead of bleeding into the blur.
 */
const farBlurShader = /* glsl */ `
uniform float focus;
uniform float ramp;
uniform float spread;
#define TAPS 16

float farBlur(const in float depth) {
  return smoothstep(focus, focus + ramp, -getViewZ(depth));
}

// Bright taps count for less, so a few that land on a lamp or LED do not sparkle as noise.
float tame(const in vec3 colour) {
  return 1.0 / (1.0 + dot(colour, vec3(0.2126, 0.7152, 0.0722)));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  float blur = farBlur(depth);
  outputColor = inputColor;
  if (blur < 0.02) return;
  // A golden-angle spiral, turned at random per pixel, covers the disc with few taps; what noise
  // is left reads as the film grain added later, not as a pattern.
  vec2 scale = vec2(blur * spread / aspect, blur * spread);
  float turn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
  float weight = tame(inputColor.rgb);
  vec3 sum = inputColor.rgb * weight;
  for (int i = 0; i < TAPS; i++) {
    float r = sqrt((float(i) + 0.5) / float(TAPS));
    float a = float(i) * 2.39996323 + turn;
    vec2 tap = uv + vec2(cos(a), sin(a)) * r * scale;
    vec3 colour = texture2D(inputBuffer, tap).rgb;
    float w = farBlur(readDepth(tap)) * tame(colour);
    sum += colour * w;
    weight += w;
  }
  outputColor.rgb = sum / weight;
}`;

/**
 * Renders the scene in high dynamic range and finishes it like a film camera in one pass: depth of
 * field beyond the court, bloom, filmic tone mapping, the court's grade, a lens vignette, and fine
 * grain.
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
  const lens = {
    focus: new THREE.Uniform(8),
    ramp: new THREE.Uniform(4),
    // Widest blur, as a fraction of the screen's height.
    spread: new THREE.Uniform(0.012),
  };
  const farBlur = new Effect("FarBlur", farBlurShader, {
    attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
    uniforms: new Map<string, THREE.Uniform>(Object.entries(lens)),
  });
  composer.addPass(
    new EffectPass(
      camera,
      farBlur,
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
    /** Keep everything up to `sharp` metres in front of the camera in focus; blur fully by `soft`. */
    setFocus(sharp: number, soft: number) {
      lens.focus.value = sharp;
      lens.ramp.value = soft - sharp;
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
