"use client";

// Foreground ringtone — port of the standalone app's Web Audio ringer:
// 880 Hz sine, two 0.34s beeps 260ms apart, repeating every 1.2s, with
// [150,100,150] vibration synced to each cycle. SDK sounds stay disabled;
// this is the only audible ring.

import { useCallback, useEffect, useRef } from "react";

export function useRingtone() {
  const ctxRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const beep = useCallback((ctx: AudioContext, startAt: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.32);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + 0.34);
  }, []);

  const start = useCallback(() => {
    if (intervalRef.current) return;
    try {
      if (!ctxRef.current) {
        ctxRef.current = new AudioContext();
      }
      const ctx = ctxRef.current;
      if (ctx.state === "suspended") void ctx.resume();

      const cycle = () => {
        const now = ctx.currentTime;
        beep(ctx, now);
        beep(ctx, now + 0.26);
        navigator.vibrate?.([150, 100, 150]);
      };
      cycle();
      intervalRef.current = setInterval(cycle, 1200);
    } catch (error) {
      console.warn("Ringtone unavailable:", error);
    }
  }, [beep]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    navigator.vibrate?.(0);
    void ctxRef.current?.suspend();
  }, []);

  /** Call from a user gesture to pre-unlock the AudioContext. */
  const unlock = useCallback(() => {
    try {
      if (!ctxRef.current) ctxRef.current = new AudioContext();
      if (ctxRef.current.state === "suspended") void ctxRef.current.resume();
    } catch {
      // no audio — ring stays visual only
    }
  }, []);

  useEffect(() => stop, [stop]);

  return { start, stop, unlock };
}
