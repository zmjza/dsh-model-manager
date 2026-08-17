/**
 * Crisp electronic blip for thinking-level changes — pure Web Audio synthesis
 * (no external assets), pitch ascends with the level so moving "smarter" is
 * heard as well as seen. The context is created lazily on the first user
 * gesture (browser autoplay policy) and reused afterwards.
 */

/** Scale step (semitones) per level, pentatonic-ish so it always sounds pleasant. */
const STEPS = [0, 3, 5, 7, 10, 12, 15] as const

let audioContext: AudioContext | null = null

/** A tiny envelope oscillator (sine → short decay). */
function blip(ctx: AudioContext, frequency: number, when: number, gain: number): void {
  const osc = ctx.createOscillator()
  const env = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = frequency
  env.gain.setValueAtTime(0, when)
  env.gain.linearRampToValueAtTime(gain, when + 0.012)
  env.gain.exponentialRampToValueAtTime(0.0001, when + 0.14)
  osc.connect(env).connect(ctx.destination)
  osc.start(when)
  osc.stop(when + 0.16)
}

/**
 * Play a selection blip for a level index (0-based, low→high).
 * @param levelIndex - position among the model's levels (0 = lowest).
 * @param levelCount - total levels, for relative pitch normalization.
 */
export function playEffortPick(levelIndex: number, levelCount: number): void {
  try {
    // Create the context on first use, inside a user gesture.
    if (audioContext === null) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (AC === undefined) return
      audioContext = new AC()
    }
    if (audioContext.state === 'suspended') void audioContext.resume()
    const ratio = levelCount > 1 ? levelIndex / (levelCount - 1) : 0
    const step = STEPS[Math.min(STEPS.length - 1, Math.round(ratio * (STEPS.length - 1)))] ?? 0
    // Base A4 → up to two octaves higher at max.
    const frequency = 440 * Math.pow(2, step / 12) * 0.5
    const when = audioContext.currentTime
    blip(audioContext, frequency, when, 0.08)
    // A quiet sub-octave makes the blip feel solid, not thin.
    blip(audioContext, frequency / 2, when, 0.04)
  } catch {
    // Non-fatal: silent harness or unavailable AudioContext (e.g. headless).
  }
}
