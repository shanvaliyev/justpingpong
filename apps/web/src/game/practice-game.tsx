import "@fontsource/dotgothic16/400.css";
import "@fontsource/press-start-2p/400.css";
import { useEffect, useRef, useState } from "react";

import { createCourtAudio, type CourtAudio } from "./audio";
import { COURT_IDS, COURTS, createCourt, type Court, type CourtId } from "./court";
import { PracticePhysics, STEP, type Phase } from "./physics";
import { PixelIcon } from "./pixel-icon";
import "./practice.css";

const randomCourt = (): CourtId => COURT_IDS[Math.floor(Math.random() * COURT_IDS.length)];
/** index.html picks the first court so its painting downloads alongside the app; use it once. */
const firstCourt = (): CourtId => {
  const { dataset } = document.documentElement;
  const picked = COURT_IDS.find((id) => id === dataset.court);
  delete dataset.court;
  return picked ?? randomCourt();
};

// Arrow keys share the WASD movement state.
const KEY_ALIASES: Record<string, string> = {
  ArrowUp: "w",
  ArrowLeft: "a",
  ArrowDown: "s",
  ArrowRight: "d",
};
const GAME_KEYS = new Set(["w", "a", "s", "d", " ", "p", "enter"]);
const normalizeKey = (key: string) => KEY_ALIASES[key] ?? key.toLowerCase();

/** Longest frame the simulation catches up on, so a stalled tab does not fast-forward. */
const MAX_FRAME = 0.05;
const HUD_INTERVAL = 80;

type Hud = { phase: Phase; rally: number; best: number; message: string };
const readHud = (game: PracticePhysics): Hud => ({
  phase: game.phase,
  rally: game.rally,
  best: game.best,
  message: game.nextBallIn > 0 ? "Next ball…" : game.netted ? "Net" : "",
});
const sameHud = (a: Hud, b: Hud) =>
  a.phase === b.phase && a.rally === b.rally && a.best === b.best && a.message === b.message;

/** An arcade score: unlit leading zeros pad it to three digits without changing what is read out. */
const Score = ({ value }: { value: number }) => (
  <>
    <span className="score-pad" aria-hidden="true">
      {"0".repeat(Math.max(0, 3 - String(value).length))}
    </span>
    {value}
  </>
);

type Card = {
  eyebrow: string;
  title: string;
  /** Decorative Japanese subtitle, as on old arcade title screens. */
  kana: string;
  body: string;
  note?: string;
  action?: { label: string; onClick: () => void };
};

export function PracticeGame() {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<{ court: Court; audio: CourtAudio } | null>(null);
  const [game] = useState(() => new PracticePhysics());
  const [courtId, setCourtId] = useState(firstCourt);
  const [hud, setHud] = useState(() => readHud(game));
  const [help, setHelp] = useState(false);
  const [error, setError] = useState(false);
  const [muted, setMuted] = useState(false);
  const court = COURTS[courtId];
  // The 3D setup holds the main thread for a while, so let the illustration and card paint first.
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    let timer = 0;
    const frame = requestAnimationFrame(() => (timer = window.setTimeout(() => setPainted(true))));
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!painted) return;
    const element = host.current!;
    let court: Court;
    try {
      court = createCourt(element);
    } catch {
      setError(true);
      return;
    }
    const audio = createCourtAudio();
    view.current = { court, audio };

    const keys = new Set<string>();
    let activePointer: number | undefined;
    let lastPointer: { y: number; time: number } | undefined;
    let frame = 0;
    let previousTime = performance.now();
    let accumulator = 0;
    let lastHud = 0;

    const draw = (time: number) => {
      const elapsed = Math.min((time - previousTime) / 1000, MAX_FRAME);
      previousTime = time;
      for (accumulator += elapsed * court.timeScale(); accumulator >= STEP; accumulator -= STEP) {
        game.step();
      }
      const impacts = game.impacts.splice(0);
      for (const impact of impacts) audio.impact(impact);
      court.render(game, impacts, elapsed, accumulator / STEP);
      if (time - lastHud > HUD_INTERVAL) {
        lastHud = time;
        const next = readHud(game);
        setHud((current) => (sameHud(current, next) ? current : next));
      }
      frame = requestAnimationFrame(draw);
    };

    const updateDrive = () => {
      game.drive = {
        x: Number(keys.has("d")) - Number(keys.has("a")),
        y: Number(keys.has("w")) - Number(keys.has("s")),
      };
    };
    const onPointerMove = (event: PointerEvent) => {
      // A mouse aims on hover; touch and pen aim only while their drag is active.
      const tracked = event.pointerId === activePointer;
      if (!tracked && (activePointer !== undefined || event.pointerType !== "mouse")) return;
      const hand = court.handAt(event.clientX, event.clientY, event.pointerType !== "mouse");
      if (hand) {
        game.target.x = hand.x;
        game.target.y = hand.y;
      }
      // A quick upward flick swings; its speed sets the power.
      if (lastPointer) {
        const elapsed = event.timeStamp - lastPointer.time;
        const upwardSpeed = (lastPointer.y - event.clientY) / Math.max(8, elapsed);
        if (elapsed < 100 && upwardSpeed > 0.45) game.swing(Math.min(1, upwardSpeed / 2));
      }
      lastPointer = { y: event.clientY, time: event.timeStamp };
    };
    const onPointerDown = (event: PointerEvent) => {
      if (activePointer !== undefined) return;
      activePointer = event.pointerId;
      element.setPointerCapture(event.pointerId);
      lastPointer = undefined;
      onPointerMove(event);
      element.focus({ preventScroll: true });
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (event.pointerId !== activePointer) return;
      activePointer = undefined;
      lastPointer = undefined;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLButtonElement) return;
      const key = normalizeKey(event.key);
      if (!GAME_KEYS.has(key)) return;
      event.preventDefault();
      keys.add(key);
      updateDrive();
      if (event.repeat) return;
      if (key === " ") game.swing();
      if (key === "p") game.togglePause();
      if (key === "enter" && game.phase === "ready") game.start();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.delete(normalizeKey(event.key));
      updateDrive();
    };
    const onBlur = () => {
      keys.clear();
      updateDrive();
      activePointer = undefined;
      lastPointer = undefined;
      if (game.phase === "playing") game.togglePause();
    };

    const listeners = new AbortController();
    const { signal } = listeners;
    window.addEventListener("pointerdown", audio.enable, { signal });
    window.addEventListener("keydown", audio.enable, { signal });
    element.addEventListener("pointerdown", onPointerDown, { signal });
    element.addEventListener("pointermove", onPointerMove, { signal });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
      element.addEventListener(type, onPointerEnd, { signal });
    }
    window.addEventListener("keydown", onKeyDown, { signal });
    window.addEventListener("keyup", onKeyUp, { signal });
    window.addEventListener("blur", onBlur, { signal });
    document.addEventListener("visibilitychange", () => document.hidden && onBlur(), { signal });
    void court.ready.then(() => {
      if (signal.aborted) return;
      previousTime = performance.now();
      frame = requestAnimationFrame(draw);
      // Warm the other backgrounds so restarting does not leave an empty court. Waiting until the
      // first court is up keeps them from competing with it for bandwidth.
      for (const { image } of Object.values(COURTS)) new Image().src = image;
    });

    return () => {
      listeners.abort();
      cancelAnimationFrame(frame);
      audio.dispose();
      court.dispose();
      view.current = null;
    };
  }, [game, painted]);

  useEffect(() => {
    view.current?.audio.setMuted(muted);
  }, [muted, painted]);

  useEffect(() => {
    view.current?.court.setCourt(courtId);
    view.current?.audio.setCourt(courtId);
  }, [courtId, painted]);

  const focusCourt = () => host.current?.focus({ preventScroll: true });
  const start = () => {
    game.start();
    focusCourt();
  };
  const togglePause = () => {
    game.togglePause();
    setHelp(false);
    focusCourt();
  };
  const restart = () => {
    setCourtId(randomCourt());
    game.restart();
    setHelp(false);
    focusCourt();
  };
  const closeHelp = () => {
    setHelp(false);
    focusCourt();
  };
  const toggleHelp = () => {
    if (!help && game.phase === "playing") game.togglePause();
    setHelp(!help);
  };
  const toggleMuted = () => {
    setMuted(!muted);
    focusCourt();
  };

  let card: Card | undefined;
  if (error) {
    card = {
      eyebrow: "WebGL unavailable",
      title: "Your court couldn’t load.",
      kana: "エラー",
      body: "Try a browser with WebGL enabled, then reload this page.",
    };
  } else if (help) {
    card = {
      eyebrow: "The basics",
      title: "Controls",
      kana: "あそびかた",
      body: "Drag a finger to move your paddle. Hold still to block; swipe sideways on contact to aim and curve. Flick up for power and topspin. Use the pause button for a break. Misses feed a new ball.",
      note: "Desktop shortcuts: arrows / WASD to move · Space to swing · P to pause.",
      action: { label: "Close", onClick: closeHelp },
    };
  } else if (hud.phase === "paused") {
    card = {
      eyebrow: court.name,
      title: "Paused",
      kana: "一時停止",
      body: "Resume to continue the rally.",
      action: { label: "Resume", onClick: togglePause },
    };
  } else if (hud.phase === "ready") {
    card = {
      eyebrow: court.name,
      title: "Table tennis",
      kana: "卓球",
      body: "Play against AI. Drag a finger to move your paddle; flick up to hit harder.",
      action: { label: "Push start", onClick: start },
    };
  }

  return (
    <main className="practice-app">
      <header className="practice-header">
        <a className="practice-brand" href="/" aria-label="justpingpong home">
          <span className="brand-mark">
            <PixelIcon name="paddle" />
          </span>
          <span className="brand-name">
            justpingpong<span className="brand-period">.</span>
          </span>
          <span className="brand-kana" lang="ja" aria-hidden="true">
            ジャストピンポン
          </span>
        </a>
        <div className="practice-actions">
          <button onClick={toggleHelp} aria-label="How to play" aria-expanded={help}>
            <PixelIcon name="help" />
          </button>
          <button
            onClick={togglePause}
            disabled={hud.phase === "ready" || error}
            aria-label={hud.phase === "paused" ? "Resume game" : "Pause game"}
          >
            <PixelIcon name={hud.phase === "paused" ? "play" : "pause"} />
          </button>
          <button
            onClick={restart}
            disabled={error}
            aria-label="Restart rally"
            title="Restart rally"
          >
            <PixelIcon name="restart" />
          </button>
        </div>
      </header>

      <section
        className="practice-stage"
        aria-label="Table tennis practice"
        data-court={courtId}
        style={{ backgroundImage: `url(${court.image})` }}
      >
        <div
          ref={host}
          className="court-canvas"
          tabIndex={0}
          role="application"
          aria-label="Table tennis court. Drag a finger to move your paddle. Swipe sideways on contact to aim; flick up to hit harder. Use the pause button to pause."
        />
        <div className="court-grade" aria-hidden="true" />
        <div className="practice-stats" aria-label="Practice statistics">
          <div>
            <span>Rally</span>
            <strong key={hud.rally}>
              <Score value={hud.rally} />
            </strong>
          </div>
          <div>
            <span>Hi-score</span>
            <strong>
              <Score value={hud.best} />
            </strong>
          </div>
        </div>

        {card && (
          <div className="practice-overlay">
            <div className="practice-card">
              <span className="card-eyebrow">{card.eyebrow}</span>
              <h2>{card.title}</h2>
              <span className="card-kana" lang="ja" aria-hidden="true">
                {card.kana}
              </span>
              <p>{card.body}</p>
              {card.note && <p className="keyboard-help">{card.note}</p>}
              {card.action && (
                <button className="play-button" onClick={card.action.onClick}>
                  <span className="play-cursor">
                    <PixelIcon name="play" />
                  </span>
                  {card.action.label}
                </button>
              )}
            </div>
          </div>
        )}

        <div className="court-bottom" role="status">
          {hud.message && (
            <span className="live-status">
              <span className="status-dot" />
              {hud.message}
            </span>
          )}
        </div>
      </section>

      <footer className="practice-footer">
        <h1 className="footer-note">
          {court.name} <span>1P vs CPU</span>
        </h1>
        <div className="control-hints">
          <span>
            <PixelIcon name="move" /> Drag to move
          </span>
          <span>
            <PixelIcon name="flick" /> Flick up
          </span>
          <button onClick={toggleHelp}>
            How to play <PixelIcon name="help" />
          </button>
          <button
            onClick={toggleMuted}
            aria-label="Mute sound"
            aria-pressed={muted}
            title={muted ? "Unmute sound" : "Mute sound"}
          >
            <PixelIcon name={muted ? "mute" : "sound"} />
          </button>
        </div>
      </footer>
    </main>
  );
}
