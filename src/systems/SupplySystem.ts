import Phaser from 'phaser';

interface SupplyHooks {
  getHealth: () => number;
  heal: (amount: number) => void;
  canAddFlare: () => boolean;
  addFlare: () => boolean;
  announce: (title: string, subtitle: string) => void;
  isGameOver: () => boolean;
}

type DropState = 'waiting' | 'descending' | 'ready' | 'opened';

export class SupplySystem {
  private readonly pickups: Phaser.Physics.Arcade.Group;
  private readonly interactKey: Phaser.Input.Keyboard.Key;
  private readonly landingZone: Phaser.GameObjects.Graphics;
  private readonly landingLabel: Phaser.GameObjects.Text;
  private readonly prompt: Phaser.GameObjects.Text;
  private state: DropState = 'waiting';
  private adrenalineUntil = 0;
  private cache?: Phaser.GameObjects.Image;
  private cacheShadow?: Phaser.GameObjects.Ellipse;
  private cacheGlow?: Phaser.GameObjects.Image;
  private cacheCollider?: Phaser.Physics.Arcade.Collider;
  private readonly dropX = 585;
  private readonly dropY = 270;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly player: Phaser.Physics.Arcade.Sprite,
    private readonly hooks: SupplyHooks,
  ) {
    this.interactKey = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.pickups = scene.physics.add.group();
    scene.physics.add.overlap(player, this.pickups, (_player, pickup) => this.collect(pickup as any));

    this.landingZone = scene.add.graphics({ x: this.dropX, y: this.dropY })
      .setDepth(15)
      .setAlpha(0.34)
      .setVisible(false);
    this.landingZone.lineStyle(1, 0xd0b86f, 0.8).strokeCircle(0, 0, 29);
    this.landingZone.lineStyle(1, 0xd0b86f, 0.34).strokeCircle(0, 0, 35);
    this.landingZone.lineBetween(-39, 0, -28, 0).lineBetween(28, 0, 39, 0);
    this.landingZone.lineBetween(0, -39, 0, -28).lineBetween(0, 28, 0, 39);
    this.landingLabel = scene.add.text(this.dropX, this.dropY + 40, 'SUPPLY READY', {
      fontFamily: '"Share Tech Mono", monospace',
      fontSize: '10px',
      color: '#cbb879',
      backgroundColor: '#0a0d0baa',
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5).setDepth(18).setAlpha(0.62).setVisible(false);
    this.prompt = scene.add.text(this.dropX, this.dropY - 48, 'E  OPEN SUPPLY DROP', {
      fontFamily: '"Share Tech Mono", monospace',
      fontSize: '12px',
      color: '#f0d889',
      backgroundColor: '#090c0acc',
      padding: { x: 6, y: 3 },
    }).setOrigin(0.5).setDepth(40).setVisible(false);

    scene.tweens.add({
      targets: [this.landingZone, this.landingLabel],
      alpha: { from: 0.28, to: 0.58 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
    scene.time.delayedCall(66000, () => this.beginDrop());
  }

  update(time: number): void {
    if (this.hooks.isGameOver()) {
      this.prompt.setVisible(false);
      return;
    }

    const canOpen = this.state === 'ready'
      && !!this.cache
      && Phaser.Math.Distance.Between(this.player.x, this.player.y, this.cache.x, this.cache.y) <= 58;
    this.prompt.setVisible(canOpen);
    if (canOpen && Phaser.Input.Keyboard.JustDown(this.interactKey)) this.openDrop();

    if (time < this.adrenalineUntil) {
      this.player.setTint(0xffd18a);
    } else if (this.player.tintTopLeft === 0xffd18a) {
      this.player.clearTint();
    }
  }

  movementMultiplier(time: number): number {
    return time < this.adrenalineUntil ? 1.22 : 1;
  }

  fireInterval(time: number): number {
    return time < this.adrenalineUntil ? 78 : 105;
  }

  adrenalineRemaining(time: number): number {
    return Math.max(0, this.adrenalineUntil - time);
  }

  private beginDrop(): void {
    if (this.hooks.isGameOver()) return;
    this.state = 'descending';
    this.hooks.announce('SUPPLY DROP INBOUND', 'LOCATE THE DROP • PRESS E TO OPEN');

    this.cacheShadow = this.scene.add.ellipse(this.dropX, this.dropY + 7, 38, 18, 0x000000, 0.36)
      .setDepth(2)
      .setScale(0.25);
    this.cacheGlow = this.scene.add.image(this.dropX, this.dropY, 'glow')
      .setDepth(16)
      .setScale(0.5)
      .setAlpha(0)
      .setTint(0xe0bd5d)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.cache = this.scene.add.image(this.dropX - 54, this.dropY - 85, 'supply-cache-closed')
      .setDepth(5)
      .setScale(1.45)
      .setAlpha(0);

    this.scene.tweens.add({
      targets: this.cache,
      x: this.dropX,
      y: this.dropY,
      scale: 1,
      alpha: 1,
      duration: 1050,
      ease: 'Quad.in',
      onComplete: () => {
        this.state = 'ready';
        this.landingZone.setVisible(true);
        this.landingLabel.setVisible(true);
        this.scene.physics.add.existing(this.cache!);
        const body = (this.cache as any).body as Phaser.Physics.Arcade.Body;
        body.setSize(38, 24, true).setImmovable(true);
        this.cacheCollider = this.scene.physics.add.collider(this.player, this.cache!);
        this.scene.cameras.main.shake(90, 0.0025);
        this.scene.tweens.add({ targets: this.cacheGlow, alpha: 0.28, duration: 240 });
      },
    });
    this.scene.tweens.add({ targets: this.cacheShadow, scale: 1, duration: 1050, ease: 'Quad.in' });
  }

  private openDrop(): void {
    if (this.state !== 'ready' || !this.cache) return;
    this.state = 'opened';
    this.prompt.setVisible(false);
    this.cacheCollider?.destroy();
    this.cacheCollider = undefined;
    ((this.cache as any).body as Phaser.Physics.Arcade.Body).enable = false;
    this.cache.setTexture('supply-cache-open');
    this.scene.tweens.add({ targets: this.cache, scaleY: 1.08, duration: 80, yoyo: true });
    const kind = this.hooks.getHealth() <= 65
      ? 'medkit'
      : this.hooks.canAddFlare() && Phaser.Math.Between(0, 99) < 35
        ? 'flare'
        : 'adrenaline';
    this.spawnPickup(kind, this.cache.x, this.cache.y - 30);
  }

  private spawnPickup(kind: 'medkit' | 'adrenaline' | 'flare', x: number, y: number): void {
    const shadow = this.scene.add.ellipse(x + 1, y + 6, 20, 9, 0x000000, 0.28).setDepth(2);
    const glow = this.scene.add.image(x, y, 'glow')
      .setDepth(16)
      .setScale(0.46)
      .setAlpha(0.25)
      .setTint(kind === 'medkit' ? 0x9fd98e : kind === 'flare' ? 0xff4a2c : 0xffb14c)
      .setBlendMode(Phaser.BlendModes.ADD);
    const texture = kind === 'flare' ? 'flare-cartridge' : kind;
    const pickup = this.pickups.create(x, y, texture)
      .setDepth(5)
      .setScale(kind === 'flare' ? 1.7 : 1)
      .setData({ kind, shadow, glow });
    const body = pickup.body as Phaser.Physics.Arcade.Body;
    if (kind === 'flare') body.setSize(22, 18, true);
    else body.setCircle(11, 21, 21);
    body.setAllowGravity(false);
    this.scene.tweens.add({
      targets: pickup,
      y: y - 4,
      duration: 720,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
      onUpdate: () => {
        shadow.setY(pickup.y + 7);
        glow.setY(pickup.y);
      },
    });
  }

  private collect(pickup: any): void {
    if (!pickup.active || this.hooks.isGameOver()) return;
    const kind = pickup.getData('kind');
    if (kind === 'medkit' && this.hooks.getHealth() >= 100) return;
    if (kind === 'flare' && !this.hooks.canAddFlare()) return;

    pickup.getData('shadow')?.destroy();
    pickup.getData('glow')?.destroy();
    this.scene.tweens.killTweensOf(pickup);
    pickup.destroy();

    if (kind === 'medkit') {
      this.hooks.heal(38);
      this.hooks.announce('VITALS RESTORED', 'FIELD MEDKIT APPLIED');
    } else if (kind === 'flare') {
      this.hooks.addFlare();
      this.hooks.announce('FLARE CARTRIDGE', 'AERIAL FLARE CHARGE ADDED');
    } else {
      this.adrenalineUntil = this.scene.time.now + 10000;
      this.hooks.announce('ADRENALINE ACTIVE', 'MOVEMENT AND FIRE RATE INCREASED');
    }
    this.clearDrop();
    this.scene.time.delayedCall(42000, () => this.beginDrop());
  }

  private clearDrop(): void {
    this.landingZone.setVisible(false);
    this.landingLabel.setVisible(false);
    this.prompt.setVisible(false);
    const targets = [this.cache, this.cacheShadow, this.cacheGlow].filter(Boolean);
    this.scene.tweens.add({
      targets,
      alpha: 0,
      duration: 650,
      onComplete: () => targets.forEach((target) => target?.destroy()),
    });
    this.cache = undefined;
    this.cacheShadow = undefined;
    this.cacheGlow = undefined;
    this.state = 'waiting';
  }
}
