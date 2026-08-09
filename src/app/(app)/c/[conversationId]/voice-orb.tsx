'use client'

import { useEffect, useRef } from 'react'

const DEFAULT_SIZE = 96

/**
 * Real-time audio-reactive orb for the recording state: a glowing gradient
 * core that pulses with actual microphone amplitude (via Web Audio's
 * AnalyserNode, not a canned loop), with two slowly counter-rotating rings
 * for a "listening" feel. Canvas rather than SVG/CSS — the redraw-every-
 * frame nature of a live audio visualization is exactly the "generative,
 * per-frame" case Canvas suits better than hand-authored path animation.
 */
export default function VoiceOrb({
  stream,
  size = DEFAULT_SIZE
}: {
  stream: MediaStream
  size?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const SIZE = size
    const dpr = window.devicePixelRatio || 1
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const audioCtx = new AudioContext()
    const source = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    const data = new Uint8Array(analyser.frequencyBinCount)
    source.connect(analyser)

    let smoothedLevel = 0
    let angle = 0
    let raf = 0

    const draw = (): void => {
      raf = requestAnimationFrame(draw)

      analyser.getByteTimeDomainData(data)
      let sumSquares = 0
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128
        sumSquares += v * v
      }
      const rms = Math.sqrt(sumSquares / data.length)
      const target = reducedMotion ? 0.15 : Math.min(1, rms * 4)
      smoothedLevel += (target - smoothedLevel) * 0.25

      const cx = SIZE / 2
      const cy = SIZE / 2
      ctx.clearRect(0, 0, SIZE, SIZE)

      angle += reducedMotion ? 0 : 0.02

      // SOFII-style rings: two arcs, counter-rotating, independent of
      // amplitude (ambient motion) so the orb never looks fully static
      // between spikes of speech.
      const scale = SIZE / DEFAULT_SIZE
      ;[SIZE * 0.42, SIZE * 0.35].forEach((r, i) => {
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(angle * (i === 0 ? 1 : -1.3))
        ctx.beginPath()
        ctx.arc(0, 0, r, 0, Math.PI * 1.3)
        ctx.strokeStyle = i === 0 ? 'rgba(96,165,250,0.55)' : 'rgba(167,139,250,0.4)'
        ctx.lineWidth = 2 * scale
        ctx.lineCap = 'round'
        ctx.stroke()
        ctx.restore()
      })

      // Core: the actual "listening" indicator — radius and glow scale with
      // live speech amplitude.
      const baseRadius = SIZE * 0.22
      const radius = baseRadius * (1 + smoothedLevel * 0.5)

      ctx.save()
      ctx.shadowBlur = (18 + smoothedLevel * 30) * scale
      ctx.shadowColor = 'rgba(129,140,248,0.9)'

      const gradient = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius)
      gradient.addColorStop(0, '#93c5fd')
      gradient.addColorStop(0.5, '#818cf8')
      gradient.addColorStop(1, '#6d28d9')
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    draw()

    return () => {
      cancelAnimationFrame(raf)
      source.disconnect()
      void audioCtx.close()
    }
  }, [stream, size])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      className="shrink-0"
      aria-hidden="true"
    />
  )
}
