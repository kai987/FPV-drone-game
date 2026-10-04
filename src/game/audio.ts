interface AudioVoice {
  source: AudioScheduledSourceNode;
  nodes: AudioNode[];
}

/** Synthesized game audio stays silent until explicitly enabled. */
export class FlightAudio {
  private context?: AudioContext;
  private motor?: OscillatorNode;
  private gain?: GainNode;
  private master?: GainNode;
  private motorFilter?: BiquadFilterNode;
  private noiseBuffer?: AudioBuffer;
  private voices = new Set<AudioVoice>();
  private disposed = false;
  enabled = false;
  async enable(enabled: boolean) {
    if (this.disposed) return;
    this.enabled = enabled;
    if (enabled && !this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
      this.motor = this.context.createOscillator();
      this.gain = this.context.createGain();
      this.motor.type = 'sawtooth';
      this.motorFilter = this.context.createBiquadFilter();
      this.motorFilter.type = 'lowpass'; this.motorFilter.frequency.value = 300;
      this.motor.connect(this.motorFilter); this.motorFilter.connect(this.gain); this.gain.connect(this.master);
      this.gain.gain.value = 0; this.motor.start();
      this.noiseBuffer = this.context.createBuffer(1, Math.ceil(this.context.sampleRate * 0.9), this.context.sampleRate);
      const samples = this.noiseBuffer.getChannelData(0);
      let seed = 7319; let softened = 0;
      for (let index = 0; index < samples.length; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const white = seed / 4294967296 * 2 - 1;
        softened = softened * 0.76 + white * 0.24;
        samples[index] = white * 0.64 + softened * 0.36;
      }
    }
    if (this.context && this.master) this.master.gain.setTargetAtTime(enabled ? 1 : 0, this.context.currentTime, 0.018);
    if (enabled) await this.context?.resume();
    else this.update(0, false);
  }
  update(speed: number, flying: boolean) {
    if (!this.context || !this.motor || !this.gain || this.disposed) return;
    const now = this.context.currentTime;
    this.motor.frequency.setTargetAtTime(62 + speed * 2.5, now, 0.1);
    this.gain.gain.setTargetAtTime(this.enabled && flying ? 0.023 : 0, now, 0.08);
  }
  private track(source: AudioScheduledSourceNode, nodes: AudioNode[]) {
    const voice: AudioVoice = { source, nodes };
    this.voices.add(voice);
    source.onended = () => { for (const node of nodes) node.disconnect(); this.voices.delete(voice); };
  }
  private tone(startFrequency: number, endFrequency: number, duration: number, volume: number, type: OscillatorType = 'sine') {
    if (!this.enabled || !this.context || !this.master || this.disposed) return;
    const now = this.context.currentTime;
    const tone = this.context.createOscillator(); const gain = this.context.createGain();
    tone.type = type;
    tone.frequency.setValueAtTime(startFrequency, now);
    tone.frequency.exponentialRampToValueAtTime(endFrequency, now + duration * 0.78);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.007);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    tone.connect(gain); gain.connect(this.master);
    this.track(tone, [tone, gain]); tone.start(now); tone.stop(now + duration + 0.015);
  }
  checkpoint() { this.tone(680, 1100, 0.25, 0.08); }
  drop() { this.tone(520, 170, 0.2, 0.055); }
  /** Low impact, a short noisy transient and a soft tail; water gets a lighter splash. */
  explosion(waterImpact = false) {
    if (!this.enabled || !this.context || !this.master || !this.noiseBuffer || this.disposed) return;
    this.tone(waterImpact ? 145 : 92, waterImpact ? 48 : 26, waterImpact ? 0.4 : 0.7,
      waterImpact ? 0.07 : 0.18, waterImpact ? 'sine' : 'triangle');
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    const lowpass = this.context.createBiquadFilter();
    const highpass = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    lowpass.type = 'lowpass'; lowpass.Q.value = 0.65;
    lowpass.frequency.setValueAtTime(waterImpact ? 2300 : 3400, now);
    lowpass.frequency.exponentialRampToValueAtTime(waterImpact ? 850 : 340, now + 0.55);
    highpass.type = 'highpass'; highpass.frequency.value = waterImpact ? 320 : 85;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(waterImpact ? 0.1 : 0.15, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(waterImpact ? 0.04 : 0.055, now + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
    source.connect(lowpass); lowpass.connect(highpass); highpass.connect(gain); gain.connect(this.master);
    this.track(source, [source, lowpass, highpass, gain]); source.start(now); source.stop(now + 0.82);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.enabled = false;
    for (const voice of this.voices) {
      try { voice.source.stop(); } catch { /* The voice may have already completed. */ }
      for (const node of voice.nodes) node.disconnect();
    }
    this.voices.clear(); this.motor?.stop(); this.motor?.disconnect(); this.motorFilter?.disconnect();
    this.gain?.disconnect(); this.master?.disconnect(); this.noiseBuffer = undefined;
    void this.context?.close();
  }
}
