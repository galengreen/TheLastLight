import Phaser from 'phaser';

export type BossKind = 'breaker' | 'lurker' | 'furnace' | 'spitter';

interface WaveDirectorHooks {
  spawnZombie: (edge?: number) => void;
  spawnBoss: (kind: BossKind, edge: number) => void;
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
      5: ['APEX CONTACT', 'THE BREAKER IS ENTERING THE KILL ZONE'],
      6: ['NO SAFE GROUND', 'ALL APPROACHES ARE COMPROMISED'],
      10: ['APEX CONTACT', 'THE LURKER IS INSIDE THE PERIMETER'],
      15: ['MULTIPLE APEX CONTACTS', 'THE FURNACE IS LEADING A BREAKER ASSAULT'],
      20: ['EXTINCTION-LEVEL CONTACT', 'THE SPITTER AND LURKER ARE CLOSING IN'],
      40: ['FOUR HORSEMEN', 'ALL APEX CONTACTS ARE CONVERGING'],
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

    const edgeCount = Math.min(4, this.wave >= 5 ? 1 + Math.floor(this.wave / 5) : 1);
    const hordeEdges = Phaser.Utils.Array.Shuffle([0, 1, 2, 3]).slice(0, edgeCount);
    hordeEdges.forEach((edge) => this.hooks.telegraphHorde(edge));
    const hordeSize = this.hordeSize();
    const spawnSpacing = Math.max(145, 260 - this.wave * 5);
    for (let i = 0; i < hordeSize; i += 1) {
      const edge = hordeEdges[i % hordeEdges.length];
      this.scene.time.delayedCall(2100 + i * spawnSpacing, () => this.hooks.spawnZombie(edge));
    }

    this.spawnMilestoneBosses(hordeEdges);
  }

  private updateSpawnRate(): void {
    if (this.spawnEvent) {
      const earlyInterval = Math.max(620, 1850 - (this.wave - 1) * 120);
      const targetInterval = this.wave <= 12
        ? earlyInterval
        : Math.max(420, 620 - (this.wave - 12) * 25);
      this.spawnEvent.timeScale = 1850 / targetInterval;
    }
  }

  private hordeSize(): number {
    if (this.wave < 5) return 2 + this.wave;
    if (this.wave < 10) return this.wave * 2 + 4;
    if (this.wave < 15) return Math.round(this.wave * 2.5 - 1);
    return Math.min(64, this.wave * 3 - 9);
  }

  private spawnMilestoneBosses(edges: number[]): void {
    const firstEdge = edges[0];
    const secondEdge = edges[Math.min(1, edges.length - 1)];
    if (this.wave === 5) this.hooks.spawnBoss('breaker', firstEdge);
    if (this.wave === 10) this.hooks.spawnBoss('lurker', firstEdge);
    if (this.wave === 15) {
      this.hooks.spawnBoss('furnace', firstEdge);
      this.scene.time.delayedCall(4200, () => this.hooks.spawnBoss('breaker', secondEdge));
    }
    if (this.wave === 20) {
      this.hooks.spawnBoss('spitter', firstEdge);
      this.scene.time.delayedCall(4200, () => this.hooks.spawnBoss('lurker', secondEdge));
    }
    if (this.wave === 40) {
      const kinds: BossKind[] = ['breaker', 'lurker', 'furnace', 'spitter'];
      kinds.forEach((kind, index) => {
        this.scene.time.delayedCall(index * 2800, () => this.hooks.spawnBoss(kind, edges[index % edges.length]));
      });
    } else if (this.wave > 20 && this.wave % 3 === 0) {
      const kinds = Phaser.Utils.Array.Shuffle<BossKind>(['breaker', 'lurker', 'furnace', 'spitter']);
      const count = this.wave >= 30 ? 3 : 2;
      kinds.slice(0, count).forEach((kind, index) => {
        this.scene.time.delayedCall(index * 3600, () => this.hooks.spawnBoss(kind, edges[index % edges.length]));
      });
    }
  }
}
