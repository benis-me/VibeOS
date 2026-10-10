import { useSettingsStore } from "@/stores/settingsStore";

/**
 * Quiet interface cues. A cue only confirms what the screen already shows, sits
 * at the edge of attention (gain ~0.06) and never fires twice in a breath.
 */
let ctx: AudioContext | undefined;
let last = 0;

/** Browsers keep audio suspended until a user gesture; start it on the first one. */
export function initSounds(): () => void {
  const unlock = () => {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
  return () => {
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  };
}

export function soundsOn(): boolean {
  return useSettingsStore.getState().settings?.prefs.uiSounds !== false;
}

/** One note: a sine with a slightly detuned triangle under it, for body without bulk. */
function note(audio: AudioContext, at: number, frequency: number, gain: number) {
  for (const [type, detune, level] of [
    ["sine", 0, 1],
    ["triangle", 6, 0.35],
  ] as const) {
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    osc.detune.value = detune;
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(gain * level, at + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    osc.connect(amp).connect(audio.destination);
    osc.start(at);
    osc.stop(at + 0.18);
  }
}

/** "Ready": two rising notes 60ms apart, heard as one small gesture. */
export function playReady(): void {
  const now = performance.now();
  // Before any gesture there is no audio yet: drop the cue rather than queue it.
  if (ctx?.state !== "running" || now - last < 1500) return;
  last = now;
  const at = ctx.currentTime + 0.01;
  note(ctx, at, 659.25, 0.06);
  note(ctx, at + 0.06, 987.77, 0.05);
}
