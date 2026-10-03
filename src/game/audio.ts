export class FlightAudio {
  private context?: AudioContext;
  private motor?: OscillatorNode;
  private gain?: GainNode;
  enabled = false;
  async enable(enabled: boolean) {
    this.enabled = enabled;
    if (enabled && !this.context) {
      this.context = new AudioContext();
      this.motor = this.context.createOscillator();
      this.gain = this.context.createGain();
      this.motor.type = 'sawtooth';
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 300;
      this.motor.connect(filter); filter.connect(this.gain); this.gain.connect(this.context.destination);
      this.gain.gain.value = 0; this.motor.start();
    }
    if (enabled) await this.context?.resume();
    else this.update(0, false);
  }
  update(speed: number, flying: boolean) {
    if (!this.context || !this.motor || !this.gain) return;
    const now = this.context.currentTime;
    this.motor.frequency.setTargetAtTime(62 + speed * 2.5, now, 0.1);
    this.gain.gain.setTargetAtTime(this.enabled && flying ? 0.023 : 0, now, 0.08);
  }
  checkpoint() {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime;
    const tone = this.context.createOscillator(); const gain = this.context.createGain();
    tone.type = 'sine'; tone.frequency.setValueAtTime(680, now); tone.frequency.exponentialRampToValueAtTime(1100, now + 0.12);
    gain.gain.setValueAtTime(0.08, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    tone.connect(gain); gain.connect(this.context.destination); tone.start(now); tone.stop(now + 0.26);
    tone.onended = () => { tone.disconnect(); gain.disconnect(); };
  }
  drop() {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime;
    const tone = this.context.createOscillator(); const gain = this.context.createGain();
    tone.type = 'sine'; tone.frequency.setValueAtTime(520, now); tone.frequency.exponentialRampToValueAtTime(170, now + 0.18);
    gain.gain.setValueAtTime(0.06, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    tone.connect(gain); gain.connect(this.context.destination); tone.start(now); tone.stop(now + 0.21);
    tone.onended = () => { tone.disconnect(); gain.disconnect(); };
  }
  explosion() {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime;
    const tone = this.context.createOscillator(); const gain = this.context.createGain();
    tone.type = 'triangle'; tone.frequency.setValueAtTime(110, now); tone.frequency.exponentialRampToValueAtTime(28, now + 0.4);
    gain.gain.setValueAtTime(0.16, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    tone.connect(gain); gain.connect(this.context.destination); tone.start(now); tone.stop(now + 0.46);
    tone.onended = () => { tone.disconnect(); gain.disconnect(); };
  }
  dispose() { this.motor?.stop(); void this.context?.close(); }
}
