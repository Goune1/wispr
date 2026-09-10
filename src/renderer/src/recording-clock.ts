// La durée retenue pour un cours est celle de l'audio réellement capté : une pause au milieu
// d'un amphi ne doit pas l'allonger, sinon la barre de conversion ffmpeg vise une mauvaise cible.
export interface CaptureClock {
  capturedMs: number
  runningSince: number | null
}

export const IDLE_CLOCK: CaptureClock = { capturedMs: 0, runningSince: null }

export function startCapture(now: number): CaptureClock {
  return { capturedMs: 0, runningSince: now }
}

export function capturedMsAt(clock: CaptureClock, now: number): number {
  return clock.capturedMs + (clock.runningSince === null ? 0 : Math.max(0, now - clock.runningSince))
}

export function pauseCapture(clock: CaptureClock, now: number): CaptureClock {
  return clock.runningSince === null ? clock : { capturedMs: capturedMsAt(clock, now), runningSince: null }
}

export function resumeCapture(clock: CaptureClock, now: number): CaptureClock {
  return clock.runningSince === null ? { ...clock, runningSince: now } : clock
}
