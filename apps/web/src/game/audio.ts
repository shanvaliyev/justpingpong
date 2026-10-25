import type { CourtId } from "./courts";
import { clamp, type Impact } from "./physics";

const VOLUME = 0.7;

// Racket and table impacts play recorded samples. Until they load (or if they fail), and for the
// net, each impact is a band-passed noise click (the crack of celluloid) over a short pitched
// body (the hollow ball), panned to where it happened. Rackets sound woody and lower, the
// table brighter, the net dull.
const VOICES = {
  racket: { band: 2100, q: 1.4, click: 0.05, body: [880, 560], bodyTime: 0.07, thump: true },
  table: { band: 4300, q: 2.6, click: 0.03, body: [1750, 1300], bodyTime: 0.045, thump: false },
  net: { band: 900, q: 0.8, click: 0.09, body: [320, 220], bodyTime: 0.06, thump: false },
};
type Voice = keyof typeof VOICES;
/** Voices with two recorded takes in /game/audio; the net has no recording. */
const RECORDED = ["racket", "table"] as const;

// Ambience is filtered noise shaped per court.
// Seaside: slow wave swells. Tokyo: low city rumble. Sakura: a light breeze.
const AMBIENCE: Record<
  CourtId,
  { filter: BiquadFilterType; frequency: number; level: number; swell: number; rate: number }
> = {
  seaside: { filter: "lowpass", frequency: 520, level: 0.05, swell: 0.035, rate: 0.11 },
  tokyo: { filter: "lowpass", frequency: 240, level: 0.06, swell: 0.012, rate: 0.05 },
  sakura: { filter: "bandpass", frequency: 850, level: 0.018, swell: 0.012, rate: 0.07 },
};
const AMBIENCE_FADE = 1.5;

export type CourtAudio = ReturnType<typeof createCourtAudio>;

export function createCourtAudio() {
  let context: AudioContext | undefined;
  let master: GainNode | undefined;
  let noise: AudioBuffer | undefined;
  let ambience: { stop: (at: number) => void } | undefined;
  let court: CourtId | undefined;
  let muted = false;
  const samples: Record<(typeof RECORDED)[number], AudioBuffer[]> = { racket: [], table: [] };

  const startAmbience = () => {
    if (!context || !master || !noise || !court) return;
    const ctx = context;
    const now = ctx.currentTime;
    ambience?.stop(now + AMBIENCE_FADE);
    const shape = AMBIENCE[court];
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = shape.filter;
    filter.frequency.value = shape.frequency;
    const level = ctx.createGain();
    level.gain.setValueAtTime(0, now);
    level.gain.linearRampToValueAtTime(shape.level, now + AMBIENCE_FADE);
    const swell = ctx.createOscillator();
    swell.frequency.value = shape.rate;
    const depth = ctx.createGain();
    depth.gain.value = shape.swell;
    swell.connect(depth).connect(level.gain);
    source.connect(filter).connect(level).connect(master);
    source.start(now, Math.random() * noise.duration);
    swell.start(now);
    ambience = {
      stop(at) {
        level.gain.cancelScheduledValues(ctx.currentTime);
        level.gain.setValueAtTime(level.gain.value, ctx.currentTime);
        level.gain.linearRampToValueAtTime(0, at);
        source.stop(at);
        swell.stop(at);
        source.onended = () => {
          for (const node of [source, filter, level, swell, depth]) node.disconnect();
        };
      },
    };
  };

  const loadSamples = (ctx: AudioContext) => {
    for (const voice of RECORDED) {
      void Promise.all(
        [1, 2].map(async (take) => {
          const response = await fetch(`/game/audio/${voice}-${take}.wav`);
          if (!response.ok) throw new Error("Impact recording unavailable");
          return ctx.decodeAudioData(await response.arrayBuffer());
        }),
      )
        .then((buffers) => {
          samples[voice] = buffers;
        })
        .catch(() => {
          /* Synthesized impacts remain available if recordings cannot load. */
        });
    }
  };

  return {
    /** Browsers allow audio only after a user gesture, so call this from one. */
    enable() {
      // Audio failure must not stop play.
      try {
        if (!context) {
          context = new AudioContext();
          master = context.createGain();
          master.gain.value = muted ? 0 : VOLUME;
          master.connect(context.destination);
          noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
          const data = noise.getChannelData(0);
          for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
          loadSamples(context);
          startAmbience();
        }
        if (context.state === "suspended") void context.resume().catch(() => {});
      } catch {
        /* Silent play is still available. */
      }
    },
    setMuted(value: boolean) {
      muted = value;
      if (master) master.gain.value = muted ? 0 : VOLUME;
    },
    setCourt(next: CourtId) {
      if (next === court) return;
      court = next;
      startAmbience();
    },
    impact(impact: Impact) {
      if (!context || !master || !noise || muted || context.state !== "running") return;
      const ctx = context;
      const kind: Voice =
        impact.surface === "player" || impact.surface === "opponent" ? "racket" : impact.surface;
      const now = ctx.currentTime;
      // The far side of the table is quieter and a little duller.
      const far = impact.position.z < -0.2;
      const out = ctx.createGain();
      const pan = ctx.createStereoPanner();
      pan.pan.value = clamp(impact.position.x / 0.9, -0.8, 0.8);
      const tone = ctx.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = far ? 3800 : 12000;
      out.connect(tone).connect(pan).connect(master);
      const nodes: AudioNode[] = [out, tone, pan];

      const clips = kind === "net" ? [] : samples[kind];
      if (clips.length) {
        const source = ctx.createBufferSource();
        source.buffer = clips[Math.floor(Math.random() * clips.length)];
        source.playbackRate.value = 0.97 + Math.random() * 0.06;
        out.gain.value = Math.min(0.85, 0.18 + impact.speed * 0.1) * (far ? 0.72 : 1);
        source.connect(out);
        source.onended = () => {
          source.disconnect();
          for (const node of nodes) node.disconnect();
        };
        source.start(now);
        return;
      }

      const voice = VOICES[kind];
      const strength = clamp(impact.speed / 8, 0.05, 1);
      out.gain.value = (far ? 0.5 : 1) * (0.25 + 0.6 * strength);
      const envelope = (peak: number, duration: number) => {
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(peak, now + 0.0015);
        gain.gain.exponentialRampToValueAtTime(0.0005, now + duration);
        gain.connect(out);
        nodes.push(gain);
        return gain;
      };

      const click = ctx.createBufferSource();
      click.buffer = noise;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = voice.band * (0.9 + strength * 0.25);
      band.Q.value = voice.q;
      click.connect(band).connect(envelope(0.9, voice.click));
      click.start(now, Math.random() * (noise.duration - 0.2), voice.click + 0.02);

      const body = ctx.createOscillator();
      body.type = "sine";
      body.frequency.setValueAtTime(voice.body[0] * (0.95 + Math.random() * 0.1), now);
      body.frequency.exponentialRampToValueAtTime(voice.body[1], now + voice.bodyTime);
      body.connect(envelope(0.35, voice.bodyTime));
      body.start(now);
      // Stops after every layer, so ending it can disconnect the whole voice.
      body.stop(now + 0.12);
      nodes.push(click, band, body);

      if (voice.thump && strength > 0.45) {
        const thump = ctx.createOscillator();
        thump.frequency.setValueAtTime(190, now);
        thump.frequency.exponentialRampToValueAtTime(80, now + 0.08);
        thump.connect(envelope(0.5 * strength, 0.09));
        thump.start(now);
        thump.stop(now + 0.1);
        nodes.push(thump);
      }
      body.onended = () => {
        for (const node of nodes) node.disconnect();
      };
    },
    dispose() {
      if (context) void context.close().catch(() => {});
    },
  };
}
