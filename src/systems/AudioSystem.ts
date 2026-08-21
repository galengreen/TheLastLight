import Phaser from 'phaser';
import { MUSIC_KEYS } from '../assets/manifest';

const MUSIC_VOLUME = 0.16;

export class AudioSystem {
  private music?: Phaser.Sound.BaseSound;
  private lastMusicKey?: string;

  constructor(private readonly scene: Phaser.Scene) {}

  startMusic(): void {
    const play = () => {
      const activeTrack = MUSIC_KEYS
        .map((key) => this.scene.sound.get(key))
        .find((track) => track?.isPlaying);
      if (activeTrack) {
        this.music = activeTrack;
        this.lastMusicKey = activeTrack.key;
        (activeTrack as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound).setVolume(MUSIC_VOLUME);
        return;
      }
      this.playNextMusicTrack();
    };
    if (this.scene.sound.locked) {
      this.scene.sound.once(Phaser.Sound.Events.UNLOCKED, play);
    } else {
      play();
    }
  }

  private playNextMusicTrack(): void {
    const choices = MUSIC_KEYS.filter((key) => key !== this.lastMusicKey);
    const key = Phaser.Math.RND.pick(choices.length > 0 ? choices : MUSIC_KEYS);
    this.lastMusicKey = key;
    const track = this.scene.sound.add(key, { volume: MUSIC_VOLUME });
    this.music = track;
    track.once(Phaser.Sound.Events.COMPLETE, () => {
      track.destroy();
      this.playNextMusicTrack();
    });
    track.play();
  }

  playTone(frequency: number, duration: number, volume: number, type: OscillatorType = 'square'): void {
    const context = this.context();
    if (!context || context.state !== 'running') return;

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(28, frequency * 0.42), context.currentTime + duration);
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }

  playNoise(duration: number, volume: number, frequency: number): void {
    const context = this.context();
    if (!context || context.state !== 'running') return;

    const frameCount = Math.floor(context.sampleRate * duration);
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < frameCount; i += 1) {
      samples[i] = (Math.random() * 2 - 1) * (1 - i / frameCount);
    }

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    filter.type = 'lowpass';
    filter.frequency.value = frequency;
    gain.gain.value = volume;
    source.connect(filter).connect(gain).connect(context.destination);
    source.start();
  }

  playAlert(): void {
    const context = this.context();
    if (!context || context.state !== 'running') return;

    const start = context.currentTime;
    [0, 0.17].forEach((delay, index) => {
      const oscillator = context.createOscillator();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      const beginsAt = start + delay;
      const endsAt = beginsAt + 0.11;
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(index === 0 ? 520 : 410, beginsAt);
      oscillator.frequency.exponentialRampToValueAtTime(index === 0 ? 410 : 330, endsAt);
      filter.type = 'bandpass';
      filter.frequency.value = 850;
      filter.Q.value = 0.8;
      gain.gain.setValueAtTime(0.001, beginsAt);
      gain.gain.exponentialRampToValueAtTime(0.045, beginsAt + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, endsAt);
      oscillator.connect(filter).connect(gain).connect(context.destination);
      oscillator.start(beginsAt);
      oscillator.stop(endsAt);
    });
    this.playNoise(0.08, 0.018, 1200);
  }

  private context(): AudioContext | undefined {
    return 'context' in this.scene.sound ? this.scene.sound.context : undefined;
  }
}
