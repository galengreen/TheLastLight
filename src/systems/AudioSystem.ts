import Phaser from 'phaser';
import { BOSS_MUSIC_KEYS, DEFEAT_MUSIC_KEYS, MUSIC_KEYS } from '../assets/manifest';

const MUSIC_VOLUME = 0.16;
const MUSIC_CROSSFADE_MS = 1100;

type BossMusicKind = keyof typeof BOSS_MUSIC_KEYS;
type MusicSound = Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound;

interface BossEncounter {
  kind: BossMusicKind;
  sequence: number;
}

const BOSS_MUSIC_PRIORITY: Record<BossMusicKind, number> = {
  breaker: 1,
  lurker: 2,
  furnace: 3,
  spitter: 4,
};

export class AudioSystem {
  private music?: MusicSound;
  private musicKey?: string;
  private lastMusicKey?: string;
  private bossSequence = 0;
  private readonly bossEncounters = new Map<number, BossEncounter>();
  private readonly musicTracks = new Set<MusicSound>();
  private fadingOut = false;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  startMusic(): void {
    const play = () => {
      if (this.destroyed) return;
      const boss = this.activeBossEncounter();
      if (boss) this.transitionTo(BOSS_MUSIC_KEYS[boss.kind], true);
      else this.playNextMusicTrack();
    };
    if (this.scene.sound.locked) {
      this.scene.sound.once(Phaser.Sound.Events.UNLOCKED, play);
    } else {
      play();
    }
  }

  beginBossTheme(kind: BossMusicKind): number {
    const encounterId = ++this.bossSequence;
    this.bossEncounters.set(encounterId, { kind, sequence: encounterId });
    const active = this.activeBossEncounter();
    if (active) this.transitionTo(BOSS_MUSIC_KEYS[active.kind], true);
    return encounterId;
  }

  endBossTheme(encounterId: number | undefined): void {
    if (encounterId === undefined || !this.bossEncounters.delete(encounterId)) return;
    const active = this.activeBossEncounter();
    if (active) this.transitionTo(BOSS_MUSIC_KEYS[active.kind], true);
    else this.playNextMusicTrack(true);
  }

  beginDefeatTheme(): void {
    if (this.destroyed) return;
    this.bossEncounters.clear();
    this.transitionTo(Phaser.Math.RND.pick(DEFEAT_MUSIC_KEYS), true);
  }

  fadeOutMusic(onComplete: () => void, duration = 700): void {
    if (this.fadingOut) return;
    this.fadingOut = true;
    const tracks = [...this.musicTracks];
    if (tracks.length === 0) {
      onComplete();
      return;
    }
    tracks.forEach((track) => this.scene.tweens.killTweensOf(track));
    this.scene.tweens.add({
      targets: tracks,
      volume: 0,
      duration,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        tracks.forEach((track) => {
          track.stop();
          track.destroy();
          this.musicTracks.delete(track);
        });
        this.music = undefined;
        this.musicKey = undefined;
        onComplete();
      },
    });
  }

  private activeBossEncounter(): BossEncounter | undefined {
    return [...this.bossEncounters.values()].sort((left, right) => (
      BOSS_MUSIC_PRIORITY[right.kind] - BOSS_MUSIC_PRIORITY[left.kind]
      || right.sequence - left.sequence
    ))[0];
  }

  private playNextMusicTrack(resumeInProgress = false): void {
    if (this.destroyed || this.bossEncounters.size > 0) return;
    const choices = MUSIC_KEYS.filter((key) => key !== this.lastMusicKey);
    const key = Phaser.Math.RND.pick(choices.length > 0 ? choices : MUSIC_KEYS);
    this.lastMusicKey = key;
    this.transitionTo(key, false, resumeInProgress ? 60 : 0);
  }

  private transitionTo(key: string, loop: boolean, seek = 0): void {
    if (this.destroyed || (this.musicKey === key && this.music)) return;

    const previous = this.music;
    const track = this.scene.sound.add(key, { volume: previous ? 0 : MUSIC_VOLUME, loop }) as MusicSound;
    this.musicTracks.add(track);
    this.music = track;
    this.musicKey = key;
    track.once(Phaser.Sound.Events.COMPLETE, () => {
      if (this.music !== track || this.destroyed) return;
      this.music = undefined;
      this.musicKey = undefined;
      this.musicTracks.delete(track);
      track.destroy();
      this.playNextMusicTrack();
    });
    track.play({ seek: Math.min(seek, Math.max(0, track.duration - 20)) });
    if (!previous) return;

    this.scene.tweens.killTweensOf(previous);
    this.scene.tweens.killTweensOf(track);
    this.scene.tweens.add({
      targets: track,
      volume: MUSIC_VOLUME,
      duration: MUSIC_CROSSFADE_MS,
      ease: 'Sine.easeInOut',
    });
    this.scene.tweens.add({
      targets: previous,
      volume: 0,
      duration: MUSIC_CROSSFADE_MS,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        if (this.music === previous) return;
        previous.stop();
        previous.destroy();
        this.musicTracks.delete(previous);
      },
    });
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

  private destroy(): void {
    this.destroyed = true;
    this.bossEncounters.clear();
    this.musicTracks.forEach((track) => {
      this.scene.tweens.killTweensOf(track);
      track.stop();
      track.destroy();
    });
    this.musicTracks.clear();
    this.music = undefined;
    this.musicKey = undefined;
  }
}
