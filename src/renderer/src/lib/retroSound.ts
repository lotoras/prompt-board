let ctx: AudioContext | null = null
let pulseWave: PeriodicWave | null = null

export function playCoinBlip(): void {
  try {
    if (!ctx) ctx = new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    if (!pulseWave) {
      const real = new Float32Array(33)
      const imag = new Float32Array(33)
      for (let n = 1; n <= 32; n++) {
        real[n] = Math.sin(2 * Math.PI * n * 0.25) / (n * Math.PI)
        imag[n] = (1 - Math.cos(2 * Math.PI * n * 0.25)) / (n * Math.PI)
      }
      pulseWave = ctx.createPeriodicWave(real, imag)
    }
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.setPeriodicWave(pulseWave)
    osc.frequency.setValueAtTime(988, t)
    osc.frequency.setValueAtTime(1319, t + 0.07)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.linearRampToValueAtTime(0.1, t + 0.005)
    gain.gain.setValueAtTime(0.1, t + 0.07)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
    osc.start(t)
    osc.stop(t + 0.35)
  } catch {
    // audio unavailable
  }
}
