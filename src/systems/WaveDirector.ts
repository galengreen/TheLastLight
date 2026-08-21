import Phaser from 'phaser';

interface WaveDirectorHooks {
  spawnZombie: (edge?: number) => void;
  telegraphHorde: (edge: number) => void;
  announce: (title: string, subtitle: string) => void;
  startPowerFailure: (wave: number) => boolean;
  isGameOver: () => boolean;
}

export class WaveDirector {
  wave = 1;

  private openingEvent?: Phaser.Time.TimerEvent;
  private spawnEvent?: Phaser.Time.TimerEvent;
  private advanceEvent?: Phaser.Time.TimerEvent;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly hooks: WaveDirectorHooks,
  ) {}

  start(): void {
    this.openingEvent = this.scene.time.delayedCall(6500, () => {
      if (this.hooks.isGameOver()) return;
      const openingEdge = Phaser.Math.Between(0, 3);
      this.hooks.telegraphHorde(openingEdge);
      this.scene.time.delayedCall(1900, () => {
        if (this.hooks.isGameOver()) return;
        this.hooks.spawnZombie(openingEdge);
        this.spawnEvent = this.scene.time.addEvent({
          delay: 1850,
          callback: () => this.hooks.spawnZombie(),
          loop: true,
        });
        this.updateSpawnRate();
      });
    });
    this.advanceEvent = this.scene.time.addEvent({
      delay: 26000,
      callback: () => this.advance(),
      loop: true,
    });
  }

  stop(): void {
    this.openingEvent?.remove();
    this.spawnEvent?.remove();
    this.advanceEvent?.remove();
  }

  private advance(): void {
    if (this.hooks.isGameOver()) return;
    this.wave += 1;
    const messages: Record<number, [string, string]> = {
      2: ['FAST MOVERS', 'RUNNERS AND CRAWLERS HAVE ENTERED THE KILL ZONE'],
      3: ['HEAVY CONTACT', 'BRUTES ARE BREAKING THROUGH'],
      5: ['BREACH WIDENING', 'CONTACTS ARE INCREASING'],
      6: ['NO SAFE GROUND', 'ALL APPROACHES ARE COMPROMISED'],
    };
    let message = messages[this.wave];
    if (this.wave === 4) {
      message = this.hooks.startPowerFailure(this.wave)
        ? ['POWER FAILURE', 'OUTPOST LIGHTS ARE COLLAPSING']
        : ['BURNING DEAD', 'CHARRED INFECTED HAVE ENTERED THE KILL ZONE'];
    }
    const escalationMessages: [string, string][] = [
      ['MASS CONTACT', 'THE HORDE IS NOT SLOWING'],
      ['PRESSURE RISING', 'MORE CONTACTS ARE CONVERGING'],
      ['SURGE DETECTED', 'ANOTHER HORDE IS CLOSING IN'],
    ];
    const fallback = escalationMessages[(this.wave - 7) % escalationMessages.length];
    const [title, subtitle] = message ?? fallback;
    this.hooks.announce(title, subtitle);
    this.updateSpawnRate();

    const hordeEdge = Phaser.Math.Between(0, 3);
    this.hooks.telegraphHorde(hordeEdge);
    const hordeSize = Math.min(10, 2 + this.wave);
    for (let i = 0; i < hordeSize; i += 1) {
      this.scene.time.delayedCall(2100 + i * 260, () => this.hooks.spawnZombie(hordeEdge));
    }
  }

  private updateSpawnRate(): void {
    if (this.spawnEvent) {
      const targetInterval = Math.max(620, 1850 - (this.wave - 1) * 120);
      this.spawnEvent.timeScale = 1850 / targetInterval;
    }
  }
}
