import Phaser from 'phaser';
import { loadAssets } from '../assets/manifest';
import {
  BULLET_SPEED,
  GAME_HEIGHT as HEIGHT,
  GAME_WIDTH as WIDTH,
  PLAYER_SPEED,
  SOUTH_FACING_OFFSET as SOUTH_OFFSET,
} from '../config/constants';
import { AudioSystem } from '../systems/AudioSystem';
import { FlareSystem } from '../systems/FlareSystem';
import { LightingSystem, type ShadowCaster } from '../systems/LightingSystem';
import { MonsterAudioSystem, type MonsterType } from '../systems/MonsterAudioSystem';
import { SupplySystem } from '../systems/SupplySystem';
import { WaveDirector } from '../systems/WaveDirector';

interface Controls {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  upAlt: Phaser.Input.Keyboard.Key;
  downAlt: Phaser.Input.Keyboard.Key;
  leftAlt: Phaser.Input.Keyboard.Key;
  rightAlt: Phaser.Input.Keyboard.Key;
  pause: Phaser.Input.Keyboard.Key;
  pauseAlt: Phaser.Input.Keyboard.Key;
  debug?: Phaser.Input.Keyboard.Key;
}

interface TreeLayers {
  x: number;
  y: number;
  canopy: Phaser.GameObjects.Image;
  canopyShadow: Phaser.GameObjects.Image;
}

export class ArenaScene extends Phaser.Scene {
  private score = 0;
  private health = 100;
  private startedAt = 0;
  private lastShot = 0;
  private lastHurt = -1000;
  private isGameOver = false;
  private isPaused = false;
  private bloodDecals: Phaser.GameObjects.Image[] = [];
  private corpses: Phaser.GameObjects.Image[] = [];
  private trees: TreeLayers[] = [];
  private floodlightPositions: { x: number; y: number }[] = [];
  private announcementQueue: [string, string][] = [];
  private announcementActive = false;

  private audio!: AudioSystem;
  private flares!: FlareSystem;
  private monsterAudio!: MonsterAudioSystem;
  private lighting!: LightingSystem;
  private supplies!: SupplySystem;
  private director!: WaveDirector;
  private keys!: Controls;
  private debugText?: Phaser.GameObjects.Text;

  // Phaser's heterogeneous Group API does not expose a useful generic element type.
  private bullets!: any;
  private zombies!: any;
  private solidProps!: any;
  private barrels!: any;
  private player!: Phaser.Physics.Arcade.Sprite;
  private playerShadow!: Phaser.GameObjects.Image;
  private playerGlow!: Phaser.GameObjects.Image;
  private tracers!: Phaser.GameObjects.Graphics;

  private scoreText!: Phaser.GameObjects.Text;
  private healthBack!: Phaser.GameObjects.Rectangle;
  private healthBar!: Phaser.GameObjects.Rectangle;
  private waveText!: Phaser.GameObjects.Text;
  private helpText!: Phaser.GameObjects.Text;
  private crosshair!: Phaser.GameObjects.Graphics;
  private pauseMenu!: Phaser.GameObjects.Container;
  private generatorBeacon!: Phaser.GameObjects.Image;
  private generatorMarker!: Phaser.GameObjects.Text;
  private statusVignette!: Phaser.GameObjects.Image;
  private adrenalineText!: Phaser.GameObjects.Text;
  private wasAdrenalineActive = false;

  constructor() {
    super('arena');
  }

  preload() {
    loadAssets(this);
  }

  create() {
    if (import.meta.env.DEV) {
      this.physics.world.drawDebug = false;
      this.physics.world.debugGraphic.clear();
    }

    this.score = 0;
    this.health = 100;
    this.startedAt = this.time.now;
    this.lastShot = 0;
    this.lastHurt = -1000;
    this.isGameOver = false;
    this.isPaused = false;
    this.bloodDecals = [];
    this.corpses = [];
    this.wasAdrenalineActive = false;
    this.announcementQueue = [];
    this.announcementActive = false;
    window.dispatchEvent(new CustomEvent('last-light:run-start'));
    this.audio = new AudioSystem(this);
    this.monsterAudio = new MonsterAudioSystem(this);

    if (!this.anims.exists('barrel-explosion')) {
      this.anims.create({
        key: 'barrel-explosion',
        frames: [40, 50, 70, 90, 120, 160].map((duration, frame) => ({
          key: 'explosion',
          frame,
          duration,
        })),
        frameRate: 1000,
        repeat: 0,
      });
    }
    if (!this.anims.exists('bullet-impact')) {
      this.anims.create({
        key: 'bullet-impact',
        frames: [40, 50, 70, 90, 120].map((duration, frame) => ({ key: 'bullet-impact', frame, duration })),
        frameRate: 1000,
      });
      this.anims.create({
        key: 'blood-hit',
        frames: [40, 50, 70, 90, 120].map((duration, frame) => ({ key: 'blood-hit', frame, duration })),
        frameRate: 1000,
      });
    }

    this.makeTextures();
    this.makeArena();
    this.makeActors();
    this.makeEnvironment();
    this.makeLightingAndAmbience();
    this.makeInterface();
    this.flares = new FlareSystem(this, this.player, this.lighting, this.audio, {
      isGeneratorOnline: () => !this.lighting.generatorDestroyed,
      isGameOver: () => this.isGameOver,
      announce: (title, subtitle) => this.announce(title, subtitle),
    });
    this.supplies = new SupplySystem(this, this.player, {
      getHealth: () => this.health,
      heal: (amount) => this.healPlayer(amount),
      canAddFlare: () => this.flares.canAddCharge(),
      addFlare: () => this.flares.addCharge(),
      announce: (title, subtitle) => this.announce(title, subtitle),
      isGameOver: () => this.isGameOver,
    });
    this.bindControls();
    this.audio.startMusic();
    this.director = new WaveDirector(this, {
      spawnZombie: (edge) => this.spawnZombie(edge),
      telegraphHorde: (edge) => this.telegraphHorde(edge),
      announce: (title, subtitle) => this.announce(title, subtitle),
      startPowerFailure: (wave) => this.startOutpostPowerFailure(wave),
      isGameOver: () => this.isGameOver,
    });
    this.director.start();

    this.physics.add.overlap(this.bullets, this.zombies, this.hitZombie, undefined, this);
    this.physics.add.overlap(this.bullets, this.barrels, this.hitBarrel, undefined, this);
    this.physics.add.overlap(this.bullets, this.solidProps, this.hitProp, undefined, this);
    this.physics.add.overlap(this.player, this.zombies, this.hurtPlayer, undefined, this);
    this.physics.add.collider(this.player, this.solidProps);
    this.physics.add.collider(this.player, this.barrels);
    this.physics.add.collider(this.zombies, this.solidProps);
    this.physics.add.collider(this.zombies, this.barrels);

    this.time.delayedCall(700, () => this.announce('HOLD THE OUTPOST', 'WASD TO MOVE • MOUSE TO AIM AND FIRE'));
    this.cameras.main.fadeIn(350, 4, 7, 6);
  }

  makeTextures() {
    // Generated textures live across scene restarts.
    if (this.textures.exists('bullet')) return;

    const g = new Phaser.GameObjects.Graphics(this);

    g.fillStyle(0xfff3b0).fillRect(0, 1, 8, 3);
    g.fillStyle(0xffad32).fillRect(0, 2, 5, 1);
    g.generateTexture('bullet', 8, 5).clear();

    g.fillStyle(0xe9b949).fillRect(0, 0, 4, 2);
    g.generateTexture('casing', 4, 2).clear();

    g.fillStyle(0xffffff).fillRect(2, 0, 3, 7).fillRect(0, 2, 7, 3);
    g.fillStyle(0xffcf4b).fillRect(2, 2, 3, 3);
    g.generateTexture('flash', 7, 7).clear();

    g.fillStyle(0x8b211e).fillRect(2, 0, 3, 2).fillRect(0, 2, 7, 4).fillRect(2, 6, 4, 2);
    g.fillStyle(0x4b1514).fillRect(2, 3, 5, 3);
    g.generateTexture('blood', 8, 8).clear();

    g.fillStyle(0xffe3a1).fillRect(0, 1, 3, 4);
    g.fillStyle(0xd93b27).fillRect(3, 0, 8, 6);
    g.fillStyle(0x71251e).fillRect(10, 1, 2, 4);
    g.generateTexture('flare-cartridge', 12, 6).clear();

    g.fillStyle(0xbca77e).fillRect(0, 0, 2, 2);
    g.generateTexture('dust', 2, 2).destroy();

    const glow = this.textures.createCanvas('glow', 128, 128)!;
    const context = glow.getContext();
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,213,107,0.34)');
    gradient.addColorStop(0.35, 'rgba(255,153,56,0.11)');
    gradient.addColorStop(1, 'rgba(255,110,20,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    glow.refresh();

    const statusVignette = this.textures.createCanvas('status-vignette', WIDTH, HEIGHT)!;
    const statusContext = statusVignette.getContext();
    const statusGradient = statusContext.createRadialGradient(
      WIDTH / 2,
      HEIGHT / 2,
      105,
      WIDTH / 2,
      HEIGHT / 2,
      515,
    );
    statusGradient.addColorStop(0, 'rgba(255,255,255,0)');
    statusGradient.addColorStop(0.52, 'rgba(255,255,255,0)');
    statusGradient.addColorStop(0.78, 'rgba(255,255,255,0.28)');
    statusGradient.addColorStop(1, 'rgba(255,255,255,0.9)');
    statusContext.fillStyle = statusGradient;
    statusContext.fillRect(0, 0, WIDTH, HEIGHT);
    statusVignette.refresh();

    const softShadow = this.textures.createCanvas('soft-shadow', 64, 32)!;
    const shadowContext = softShadow.getContext();
    shadowContext.save();
    shadowContext.scale(1, 0.5);
    const shadowGradient = shadowContext.createRadialGradient(32, 32, 3, 32, 32, 30);
    shadowGradient.addColorStop(0, 'rgba(0,0,0,0.62)');
    shadowGradient.addColorStop(0.48, 'rgba(0,0,0,0.4)');
    shadowGradient.addColorStop(0.78, 'rgba(0,0,0,0.13)');
    shadowGradient.addColorStop(1, 'rgba(0,0,0,0)');
    shadowContext.fillStyle = shadowGradient;
    shadowContext.fillRect(2, 2, 60, 60);
    shadowContext.restore();
    softShadow.refresh();

    const projectedShadow = this.textures.createCanvas('projected-shadow', 192, 64)!;
    const projectedContext = projectedShadow.getContext();
    const projectedPixels = projectedContext.createImageData(192, 64);
    const smoothstep = (start: number, end: number, value: number) => {
      const amount = Phaser.Math.Clamp((value - start) / (end - start), 0, 1);
      return amount * amount * (3 - 2 * amount);
    };
    for (let pixelY = 0; pixelY < 64; pixelY += 1) {
      for (let pixelX = 0; pixelX < 192; pixelX += 1) {
        const progress = pixelX / 191;
        const halfWidth = 10 + progress * 15;
        const edgeDistance = Math.abs(pixelY - 31.5) / halfWidth;
        const edgeFade = Math.exp(-Math.pow(edgeDistance * 1.65, 2));
        const lengthFade = Math.pow(1 - progress, 1.05);
        const startRound = smoothstep(0, 0.055, progress);
        const alpha = Math.round(190 * edgeFade * lengthFade * startRound);
        const offset = (pixelY * 192 + pixelX) * 4;
        projectedPixels.data[offset + 3] = alpha;
      }
    }
    projectedContext.putImageData(projectedPixels, 0, 0);
    projectedShadow.refresh();

    const flareColorMask = this.textures.createCanvas('flare-color-mask', 512, 512)!;
    const flareContext = flareColorMask.getContext();
    const flareGradient = flareContext.createRadialGradient(256, 256, 0, 256, 256, 256);
    flareGradient.addColorStop(0, 'rgba(255,255,248,1)');
    flareGradient.addColorStop(0.035, 'rgba(255,250,232,1)');
    flareGradient.addColorStop(0.07, 'rgba(255,148,104,0.98)');
    flareGradient.addColorStop(0.12, 'rgba(255,35,24,0.9)');
    flareGradient.addColorStop(0.4, 'rgba(204,5,22,0.68)');
    flareGradient.addColorStop(0.7, 'rgba(106,0,20,0.42)');
    flareGradient.addColorStop(0.9, 'rgba(52,0,13,0.14)');
    flareGradient.addColorStop(1, 'rgba(32,0,9,0)');
    flareContext.fillStyle = flareGradient;
    flareContext.fillRect(0, 0, 512, 512);
    flareColorMask.refresh();

    const lightMask = this.textures.createCanvas('light-mask', 256, 256)!;
    const maskContext = lightMask.getContext();
    const maskGradient = maskContext.createRadialGradient(128, 128, 0, 128, 128, 128);
    maskGradient.addColorStop(0, 'rgba(255,255,255,1)');
    maskGradient.addColorStop(0.42, 'rgba(255,255,255,0.82)');
    maskGradient.addColorStop(0.72, 'rgba(255,255,255,0.28)');
    maskGradient.addColorStop(1, 'rgba(255,255,255,0)');
    maskContext.fillStyle = maskGradient;
    maskContext.fillRect(0, 0, 256, 256);
    lightMask.refresh();

    // A continuous directional falloff avoids visible nested-cone bands.
    const beamMask = this.textures.createCanvas('beam-mask', 512, 512)!;
    const beamContext = beamMask.getContext();
    const beamPixels = beamContext.createImageData(512, 512);
    const sourceX = 40;
    const sourceY = 256;
    const beamSmoothstep = (start: number, end: number, value: number) => {
      const amount = Phaser.Math.Clamp((value - start) / (end - start), 0, 1);
      return amount * amount * (3 - 2 * amount);
    };
    for (let pixelY = 0; pixelY < 512; pixelY += 1) {
      for (let pixelX = 0; pixelX < 512; pixelX += 1) {
        const dx = pixelX - sourceX;
        const dy = pixelY - sourceY;
        const distance = Math.hypot(dx, dy);
        const angle = Math.abs(Math.atan2(dy, Math.max(dx, 0.001)));
        const distanceFade = 1 - beamSmoothstep(24, 445, distance);
        const edgeFade = dx > 0 ? 1 - beamSmoothstep(0.08, 0.42, angle) : 0;
        const alpha = Math.round(255 * Math.pow(distanceFade * edgeFade, 1.35));
        const offset = (pixelY * 512 + pixelX) * 4;
        beamPixels.data[offset] = 255;
        beamPixels.data[offset + 1] = 255;
        beamPixels.data[offset + 2] = 255;
        beamPixels.data[offset + 3] = alpha;
      }
    }
    beamContext.putImageData(beamPixels, 0, 0);
    beamMask.refresh();
  }

  makeArena() {
    const groundKeys = ['ground-a', 'ground-b', 'ground-c', 'ground-d'];
    const groundRandom = new Phaser.Math.RandomDataGenerator(['wasteland-arena']);
    const columns = Math.ceil(WIDTH / 64);
    const rows = Math.ceil(HEIGHT / 64);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        this.add.image(column * 64 + 32, row * 64 + 32, groundRandom.pick(groundKeys))
          .setFlip(groundRandom.integerInRange(0, 1) === 1, groundRandom.integerInRange(0, 1) === 1)
          .setDepth(-20);
      }
    }

    const marks = this.add.graphics().setDepth(-19);
    marks.lineStyle(2, 0x5e4a32, 0.55).strokeRect(11, 11, WIDTH - 22, HEIGHT - 22);
    marks.lineStyle(1, 0x1c130d, 0.75).strokeRect(15, 15, WIDTH - 30, HEIGHT - 30);

    // Faded range markings provide movement reference without obscuring the ground art.
    marks.lineStyle(2, 0xc2a36f, 0.1);
    marks.strokeCircle(WIDTH / 2, HEIGHT / 2, 116);
    marks.lineBetween(WIDTH / 2 - 140, HEIGHT / 2, WIDTH / 2 + 140, HEIGHT / 2);
    marks.lineBetween(WIDTH / 2, HEIGHT / 2 - 140, WIDTH / 2, HEIGHT / 2 + 140);

    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x0e0906, 0.1).setDepth(13);
  }

  makeActors() {
    this.bullets = this.physics.add.group({ classType: Phaser.Physics.Arcade.Image, maxSize: 80 });
    this.zombies = this.physics.add.group();

    this.playerShadow = this.add.image(WIDTH / 2 + 2, HEIGHT / 2 + 3, 'soft-shadow')
      .setDisplaySize(36, 18)
      .setAlpha(0.72)
      .setDepth(1);
    this.playerGlow = this.add.image(WIDTH / 2, HEIGHT / 2, 'glow')
      .setScale(0.85)
      .setAlpha(0.38)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(16);

    this.player = this.physics.add.sprite(WIDTH / 2, HEIGHT / 2, 'soldier').setDepth(4);
    this.player.setCollideWorldBounds(true);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setCircle(12, 20, 9);
    body.setMaxVelocity(PLAYER_SPEED);

    this.tracers = this.add.graphics().setDepth(18).setBlendMode(Phaser.BlendModes.ADD);
  }

  makeEnvironment() {
    this.solidProps = this.physics.add.staticGroup();
    this.barrels = this.physics.add.staticGroup();
    this.trees = [];
    this.floodlightPositions = [
      { x: 285, y: 170 },
      { x: 675, y: 170 },
      { x: 285, y: 370 },
      { x: 675, y: 370 },
    ];

    const addShadow = (x, y, key, rotation = 0, alpha = 0.25) => this.add.image(x + 3, y + 4, key)
      .setDepth(1)
      .setRotation(rotation)
      .setTintFill(0x000000)
      .setAlpha(alpha);

    const centerStaticBody = (body, x, y) => {
      body.world.staticTree.remove(body);
      body.position.set(x - body.halfWidth, y - body.halfHeight);
      body.offset.set(0, 0);
      body.updateCenter();
      body.world.staticTree.insert(body);
    };

    const addSolid = (x, y, key, width, height, rotation = 0, health = 0) => {
      const prop = this.solidProps.create(x, y, key).setDepth(2).setRotation(rotation);
      prop.refreshBody();
      prop.body.setSize(width, height, false);
      centerStaticBody(prop.body, x, y);
      prop.setData({ health, shadow: addShadow(x, y, key, rotation) });
      return prop;
    };

    const generator = addSolid(365, 270, 'generator', 48, 36, 0, 7).setData('kind', 'generator');
    this.generatorBeacon = this.add.image(365, 266, 'glow')
      .setDepth(16)
      .setScale(0.42)
      .setAlpha(0.32)
      .setTint(0x9fcf9b)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.generatorMarker = this.add.text(365, 307, 'OUTPOST GENERATOR  •  ONLINE', {
      fontFamily: '"Share Tech Mono", monospace',
      fontSize: '10px',
      color: '#b9d0a9',
      backgroundColor: '#080c09bb',
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5).setDepth(18).setAlpha(0.76);
    generator.setData({ kind: 'generator', beacon: this.generatorBeacon, marker: this.generatorMarker });

    [[390, 170, 0, 52, 12], [446, 170, 0, 52, 12], [514, 370, 0, 52, 12], [570, 370, 0, 52, 12],
      [285, 246, Math.PI / 2, 12, 52], [675, 294, Math.PI / 2, 12, 52]].forEach(([x, y, rotation, width, height]) => {
      addSolid(x, y, 'sandbags', width, height, rotation).setData('bulletPassThrough', true);
    });
    // A wrecked response vehicle has skidded through the northeast perimeter.
    const crashMarks = this.add.graphics().setDepth(-18);
    crashMarks.lineStyle(4, 0x21160f, 0.34);
    crashMarks.lineBetween(WIDTH + 8, 74, 892, 87);
    crashMarks.lineBetween(WIDTH + 8, 112, 892, 104);
    crashMarks.fillStyle(0x271912, 0.48)
      .fillRect(838, 72, 5, 3)
      .fillRect(856, 126, 7, 4)
      .fillRect(927, 139, 4, 3);
    addSolid(900, 98, 'wrecked-vehicle', 108, 54, -Math.PI / 2).setData('kind', 'wrecked-vehicle');

    this.floodlightPositions.forEach(({ x, y }, index) => {
      const rotation = Phaser.Math.Angle.Between(x, y, WIDTH / 2, HEIGHT / 2) + Math.PI / 2;
      const floodlight = addSolid(x, y, 'floodlight', 18, 18, rotation, 3);
      const bodyX = x + Math.sin(rotation) * 7;
      const bodyY = y - Math.cos(rotation) * 7;
      floodlight.body.setCircle(9, 0, 0);
      centerStaticBody(floodlight.body, bodyX, bodyY);
      floodlight.setData({ kind: 'floodlight', lightIndex: index });
    });

    [[86, 92, -0.1], [796, 70, 0.35], [92, 450, -0.42], [866, 452, 0.18]].forEach(([x, y, rotation]) => {
      const trunk = addSolid(x, y, 'tree-trunk', 19, 19, rotation);
      trunk.body.setCircle(10, 0, 0);
      centerStaticBody(trunk.body, x, y);
      const canopyShadow = this.add.image(x + 7, y + 9, 'tree-canopy')
        .setDepth(0)
        .setRotation(rotation)
        .setTintFill(0x000000)
        .setAlpha(0.2);
      const canopy = this.add.image(x, y, 'tree-canopy').setDepth(12).setRotation(rotation).setAlpha(0.96);
      this.trees.push({ x, y, canopy, canopyShadow });
    });

    // Decorative trees sit just inside the playable bounds. Their raised canopies
    // conceal edge spawns without creating an impassable collision wall.
    const forestRandom = new Phaser.Math.RandomDataGenerator(['last-light-forest']);
    const forestEdge: [number, number][] = [
      [38, 18], [142, 12], [252, 20], [365, 13], [478, 18], [590, 12], [704, 20],
      [32, HEIGHT - 17], [137, HEIGHT - 12], [246, HEIGHT - 19], [357, HEIGHT - 13],
      [472, HEIGHT - 18], [585, HEIGHT - 12], [700, HEIGHT - 19], [815, HEIGHT - 13], [930, HEIGHT - 18],
      [17, 70], [12, 180], [19, 292], [13, 405], [18, 510],
      [WIDTH - 18, 185], [WIDTH - 12, 296], [WIDTH - 19, 408], [WIDTH - 14, 512],
    ];
    forestEdge.forEach(([x, y]) => {
      const rotation = forestRandom.realInRange(-0.5, 0.5);
      const scale = forestRandom.realInRange(0.86, 1.08);
      this.add.image(x, y, 'tree-trunk')
        .setDepth(2)
        .setRotation(rotation)
        .setScale(scale)
        .setTint(0x8c826d);
      const canopyShadow = this.add.image(x + 7, y + 9, 'tree-canopy')
        .setDepth(0)
        .setRotation(rotation)
        .setScale(scale)
        .setTintFill(0x000000)
        .setAlpha(0.24);
      const canopy = this.add.image(x, y, 'tree-canopy')
        .setDepth(12)
        .setRotation(rotation)
        .setScale(scale)
        .setAlpha(0.98);
      this.trees.push({ x, y, canopy, canopyShadow });
    });

    [[238, 270], [722, 270], [480, 420]].forEach(([x, y]) => {
      const barrel = this.barrels.create(x, y, 'barrel').setDepth(2).setRotation(Phaser.Math.FloatBetween(-0.2, 0.2));
      barrel.refreshBody();
      barrel.body.setCircle(21, 0, 0);
      centerStaticBody(barrel.body, x, y);
      barrel.setData({ health: 2, shadow: addShadow(x, y, 'barrel', barrel.rotation, 0.3), exploded: false });
    });
  }

  makeLightingAndAmbience() {
    this.lighting = new LightingSystem(this, this.floodlightPositions, () => this.spawnDust());
    this.lighting.redraw(this.player.x, this.player.y, Math.PI / 2);
  }

  makeInterface() {
    const labelStyle = {
      fontFamily: '"Share Tech Mono", monospace',
      fontSize: '13px',
      color: '#ad8880',
    };
    this.add.text(24, 20, 'ELIMINATIONS', labelStyle).setDepth(30);
    this.scoreText = this.add.text(22, 31, '00000', {
      fontFamily: '"Changa One", sans-serif',
      fontSize: '34px',
      color: '#f3e7c4',
      stroke: '#0a0d0b',
      strokeThickness: 5,
    }).setDepth(30);

    this.healthBack = this.add.rectangle(this.player.x, this.player.y - 36, 38, 6, 0x0a0b0a, 0.58)
      .setStrokeStyle(1, 0x4d3029, 0.65)
      .setDepth(20);
    this.healthBar = this.add.rectangle(this.player.x, this.player.y - 36, 34, 2, 0xd4d37b, 0.76)
      .setDepth(21);
    this.statusVignette = this.add.image(WIDTH / 2, HEIGHT / 2, 'status-vignette')
      .setDepth(24)
      .setTint(0xff642f)
      .setAlpha(0)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.adrenalineText = this.add.text(WIDTH - 25, 96, '', {
      ...labelStyle,
      fontSize: '10px',
      color: '#ff9b57',
      backgroundColor: '#160b08cc',
      padding: { x: 5, y: 2 },
    }).setOrigin(1, 0).setDepth(31).setVisible(false);

    this.waveText = this.add.text(WIDTH / 2, 20, 'THREAT 01', {
      ...labelStyle,
      color: '#c86759',
    }).setOrigin(0.5, 0).setDepth(30);
    this.helpText = this.add.text(WIDTH / 2, HEIGHT - 20, 'WASD / ARROWS  MOVE  •  MOUSE  AIM + FIRE  •  P / ESC  PAUSE', {
      ...labelStyle,
      color: '#c9b8ad',
      backgroundColor: '#0b0e0ccc',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 1).setDepth(30);
    this.tweens.add({ targets: this.helpText, alpha: 0, delay: 7600, duration: 1200 });

    this.crosshair = this.add.graphics().setDepth(40);
    this.crosshair.lineStyle(1, 0xf3dc95, 0.9);
    this.crosshair.strokeCircle(0, 0, 7);
    this.crosshair.lineBetween(-11, 0, -5, 0).lineBetween(5, 0, 11, 0);
    this.crosshair.lineBetween(0, -11, 0, -5).lineBetween(0, 5, 0, 11);

    if (import.meta.env.DEV) {
      this.debugText = this.add.text(WIDTH - 18, HEIGHT - 16, 'DEV • COLLISION BODIES • F2', {
        ...labelStyle,
        fontSize: '11px',
        color: '#5dffad',
        backgroundColor: '#07110ccc',
        padding: { x: 6, y: 3 },
      }).setOrigin(1, 1).setDepth(70).setVisible(false);
    }

    const pauseShade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x050303, 0.88).setInteractive();
    const pausePanel = this.add.rectangle(WIDTH / 2, HEIGHT / 2, 500, 390, 0x0c0d0c, 0.97)
      .setStrokeStyle(3, 0x8d2f27, 0.95);
    const pauseInner = this.add.rectangle(WIDTH / 2, HEIGHT / 2, 484, 374)
      .setStrokeStyle(1, 0x4c211d, 0.95);
    const pauseAccent = this.add.rectangle(WIDTH / 2, HEIGHT / 2 - 187, 484, 5, 0xc44636, 0.95);
    const pauseRule = this.add.rectangle(WIDTH / 2, HEIGHT / 2 - 92, 390, 2, 0x7d2b24, 0.85);
    const pauseStatus = this.add.text(WIDTH / 2, HEIGHT / 2 - 162, 'FIELD OPERATIONS // SUSPENDED', {
      ...labelStyle,
      fontSize: '11px',
      color: '#d04d3d',
    }).setOrigin(0.5);
    const pauseTitle = this.add.text(WIDTH / 2, HEIGHT / 2 - 128, 'PAUSED', {
      fontFamily: '"Changa One", sans-serif',
      fontSize: '52px',
      color: '#e8dfcf',
      stroke: '#4f1714',
      strokeThickness: 7,
    }).setOrigin(0.5);
    const pauseControls = this.add.text(WIDTH / 2, HEIGHT / 2 - 31,
      'MOVE       WASD / ARROWS\nAIM        MOUSE\nFIRE       LEFT MOUSE\nFLARE      F\nINTERACT   E', {
        ...labelStyle,
        fontSize: '15px',
        color: '#d4c9b8',
        lineSpacing: 7,
      }).setOrigin(0.5);
    const pauseResumeButton = this.makeOverlayButton(
      WIDTH / 2 - 106,
      HEIGHT / 2 + 93,
      196,
      'RESUME',
      true,
      () => this.togglePause(),
    );
    const pauseMenuButton = this.makeOverlayButton(
      WIDTH / 2 + 106,
      HEIGHT / 2 + 93,
      196,
      'MAIN MENU',
      false,
      () => this.returnToMenu(),
    );
    const pauseShortcut = this.add.text(WIDTH / 2, HEIGHT / 2 + 160, 'P / ESC  RESUME FIELD OPERATIONS', {
      ...labelStyle,
      fontSize: '11px',
      color: '#81766f',
    }).setOrigin(0.5);
    this.pauseMenu = this.add.container(0, 0, [
      pauseShade,
      pausePanel,
      pauseInner,
      pauseAccent,
      pauseRule,
      pauseStatus,
      pauseTitle,
      pauseControls,
      ...pauseResumeButton,
      ...pauseMenuButton,
      pauseShortcut,
    ]).setDepth(60).setVisible(false);
  }

  private makeOverlayButton(
    x: number,
    y: number,
    width: number,
    text: string,
    primary: boolean,
    action: () => void,
  ): Phaser.GameObjects.GameObject[] {
    const restingFill = primary ? 0x9d3027 : 0x151413;
    const hoverFill = primary ? 0xc44636 : 0x2a1a18;
    const button = this.add.rectangle(x, y, width, 44, restingFill, 1)
      .setStrokeStyle(2, primary ? 0xe26954 : 0x71312a, 1)
      .setInteractive({ useHandCursor: true });
    const label = this.add.text(x, y, text, {
      fontFamily: '"Share Tech Mono", monospace',
      fontSize: '16px',
      color: primary ? '#fff0dc' : '#d8cdc0',
    }).setOrigin(0.5);

    button.on('pointerover', () => button.setFillStyle(hoverFill));
    button.on('pointerout', () => button.setFillStyle(restingFill));
    button.on('pointerup', action);
    return [button, label];
  }

  private returnToMenu(): void {
    if (!this.isGameOver) {
      window.dispatchEvent(new CustomEvent('last-light:game-over', {
        detail: { score: this.score, survivalMs: this.time.now - this.startedAt },
      }));
    }
    window.dispatchEvent(new CustomEvent('last-light:return-menu'));
  }

  bindControls() {
    this.keys = this.input.keyboard!.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      upAlt: Phaser.Input.Keyboard.KeyCodes.UP,
      downAlt: Phaser.Input.Keyboard.KeyCodes.DOWN,
      leftAlt: Phaser.Input.Keyboard.KeyCodes.LEFT,
      rightAlt: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      pause: Phaser.Input.Keyboard.KeyCodes.P,
      pauseAlt: Phaser.Input.Keyboard.KeyCodes.ESC,
      ...(import.meta.env.DEV ? { debug: Phaser.Input.Keyboard.KeyCodes.F2 } : {}),
    }) as unknown as Controls;
    this.input.mouse!.disableContextMenu();
    this.input.on('pointerdown', () => {
      if (this.sound.locked) this.sound.unlock?.();
    });
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    this.pauseMenu.setVisible(this.isPaused);
    this.crosshair.setVisible(!this.isPaused);

    if (this.isPaused) {
      this.player.setVelocity(0);
      this.physics.world.pause();
      this.time.paused = true;
      this.anims.pauseAll();
      this.tweens.pauseAll();
      this.sound.pauseAll?.();
      this.monsterAudio.setPaused(true);
      return;
    }

    this.physics.world.resume();
    this.time.paused = false;
    this.anims.resumeAll();
    this.tweens.resumeAll();
    this.sound.resumeAll?.();
    this.monsterAudio.setPaused(false);
  }

  spawnDust() {
    if (this.isGameOver || Phaser.Math.Between(0, 100) < 24) return;
    const dust = this.add.image(-4, Phaser.Math.Between(30, HEIGHT - 30), 'dust')
      .setDepth(18)
      .setAlpha(Phaser.Math.FloatBetween(0.12, 0.34))
      .setScale(Phaser.Math.Between(1, 2));
    this.tweens.add({
      targets: dust,
      x: WIDTH + 8,
      y: dust.y + Phaser.Math.Between(-24, 24),
      alpha: 0,
      duration: Phaser.Math.Between(4200, 7200),
      onComplete: () => dust.destroy(),
    });
  }

  private telegraphHorde(edge: number): void {
    if (this.isGameOver) return;
    const warningX = edge === 1 ? WIDTH - 20 : edge === 3 ? 20 : WIDTH / 2;
    const warningY = edge === 0 ? 20 : edge === 2 ? HEIGHT - 20 : HEIGHT / 2;
    this.monsterAudio.play('shambler', 'spawn', warningX, warningY, this.player.x, this.player.y);
    for (let i = 0; i < 3; i += 1) {
      const along = Phaser.Math.Between(-95, 95);
      const eyeX = edge === 0 || edge === 2 ? Phaser.Math.Clamp(WIDTH / 2 + along, 50, WIDTH - 50) : warningX;
      const eyeY = edge === 1 || edge === 3 ? Phaser.Math.Clamp(HEIGHT / 2 + along, 50, HEIGHT - 50) : warningY;
      const eyes = this.add.container(eyeX, eyeY, [
        this.add.ellipse(-3, 0, 3, 2, 0xff4a2d, 0.9),
        this.add.ellipse(3, 0, 3, 2, 0xff4a2d, 0.9),
      ]).setDepth(16).setAlpha(0);
      this.tweens.add({
        targets: eyes,
        alpha: 0.85,
        duration: 180,
        yoyo: true,
        hold: 850 + i * 130,
        onComplete: () => eyes.destroy(),
      });
    }
  }

  announce(title: string, subtitle: string) {
    if (this.isGameOver) return;
    this.announcementQueue.push([title, subtitle]);
    if (!this.announcementActive) this.showNextAnnouncement();
  }

  private showNextAnnouncement(): void {
    const message = this.announcementQueue.shift();
    if (!message || this.isGameOver) {
      this.announcementActive = false;
      return;
    }
    this.announcementActive = true;
    const [title, subtitle] = message;
    this.audio.playAlert();
    const titleText = this.add.text(WIDTH / 2, 57, title, {
      fontFamily: '"Changa One", sans-serif',
      fontSize: '34px',
      color: '#e05d4b',
      stroke: '#130e0b',
      strokeThickness: 6,
    }).setOrigin(0.5).setDepth(45).setAlpha(0).setScale(1.2);
    const subtitleText = this.add.text(WIDTH / 2, 88, subtitle, {
      fontFamily: '"Share Tech Mono", monospace',
      fontSize: '13px',
      color: '#d4b3a9',
      backgroundColor: '#160b0acc',
      padding: { x: 7, y: 3 },
    }).setOrigin(0.5).setDepth(45).setAlpha(0);
    this.tweens.add({ targets: titleText, alpha: 1, scale: 1, duration: 220, hold: 2500, yoyo: true, onComplete: () => titleText.destroy() });
    this.tweens.add({
      targets: subtitleText,
      alpha: 1,
      duration: 220,
      hold: 2500,
      yoyo: true,
      onComplete: () => {
        subtitleText.destroy();
        this.announcementActive = false;
        this.showNextAnnouncement();
      },
    });
  }

  private startOutpostPowerFailure(wave: number): boolean {
    const started = this.lighting.startPowerFailure(wave);
    if (started) {
      this.generatorBeacon.setTint(0xffa343).setAlpha(0.25);
      this.generatorMarker.setText('OUTPOST GENERATOR  •  UNSTABLE').setColor('#d8a55f');
    }
    return started;
  }

  update(time) {
    const pointer = this.input.activePointer;
    this.crosshair.setPosition(Math.round(pointer.worldX), Math.round(pointer.worldY));

    if (import.meta.env.DEV && Phaser.Input.Keyboard.JustDown(this.keys.debug!)) {
      const enabled = !this.physics.world.drawDebug;
      this.physics.world.drawDebug = enabled;
      this.debugText!.setVisible(enabled);
      if (!enabled) this.physics.world.debugGraphic.clear();
    }

    if (!this.isGameOver && (
      Phaser.Input.Keyboard.JustDown(this.keys.pause)
      || Phaser.Input.Keyboard.JustDown(this.keys.pauseAlt)
    )) {
      this.togglePause();
    }

    if (this.isPaused) return;

    if (this.isGameOver) {
      this.player.setVelocity(0);
      return;
    }

    const horizontal = Number(this.keys.right.isDown || this.keys.rightAlt.isDown)
      - Number(this.keys.left.isDown || this.keys.leftAlt.isDown);
    const vertical = Number(this.keys.down.isDown || this.keys.downAlt.isDown)
      - Number(this.keys.up.isDown || this.keys.upAlt.isDown);
    const moveSpeed = PLAYER_SPEED * this.supplies.movementMultiplier(time);
    const movement = new Phaser.Math.Vector2(horizontal, vertical)
      .normalize()
      .scale(moveSpeed);
    (this.player.body as Phaser.Physics.Arcade.Body).setMaxVelocity(moveSpeed);
    this.player.setVelocity(movement.x, movement.y);
    this.supplies.update(time);

    const aim = Phaser.Math.Angle.Between(this.player.x, this.player.y, pointer.worldX, pointer.worldY);
    this.player.rotation = aim - SOUTH_OFFSET;
    (this.player.body as Phaser.Physics.Arcade.Body).setCircle(
      12,
      20 - Math.cos(aim) * 11,
      20 - Math.sin(aim) * 11,
    );
    this.playerShadow
      .setPosition(this.player.x + 2, this.player.y + 3)
      .setRotation(this.player.rotation);
    this.playerGlow.setPosition(this.player.x, this.player.y);
    const healthBarX = this.player.x - Math.cos(aim) * 36;
    const healthBarY = this.player.y - Math.sin(aim) * 36;
    this.healthBack.setPosition(healthBarX, healthBarY).setRotation(this.player.rotation);
    const healthFillOffset = (this.healthBar.width - 34) / 2;
    this.healthBar
      .setPosition(
        healthBarX + Math.cos(this.player.rotation) * healthFillOffset,
        healthBarY + Math.sin(this.player.rotation) * healthFillOffset,
      )
      .setRotation(this.player.rotation);
    this.flares.update(time, aim);
    this.updateStatusEffects(time);

    if (pointer.isDown && time - this.lastShot >= this.supplies.fireInterval(time)) this.shoot(aim, time);

    this.waveText.setText(`THREAT ${String(this.director.wave).padStart(2, '0')}`);
    this.lighting.lowHealthShade.setAlpha(this.health <= 35 ? 0.035 + Math.sin(time * 0.006) * 0.025 : 0);
    this.tracers.clear().lineStyle(2, 0xffd66f, 0.7);

    this.trees.forEach(({ x, y, canopy }) => {
      const targetAlpha = Phaser.Math.Distance.Between(this.player.x, this.player.y, x, y) < 54 ? 0.34 : 0.96;
      canopy.setAlpha(Phaser.Math.Linear(canopy.alpha, targetAlpha, 0.12));
    });

    this.zombies.children.iterate((zombie) => {
      if (!zombie?.active) return;
      const angle = Phaser.Math.Angle.Between(zombie.x, zombie.y, this.player.x, this.player.y);
      const crawler = zombie.getData('type') === 'crawler';
      const crawlPulse = crawler ? 0.68 + Math.max(0, Math.sin(zombie.getData('step') * 1.7)) * 0.32 : 1;
      const speed = zombie.getData('speed') * crawlPulse;
      if (time >= zombie.getData('staggerUntil')) {
        zombie.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
      }
      zombie.rotation = angle - SOUTH_OFFSET;
      if (crawler) {
        zombie.body.setSize(17, 10, false).setOffset(23.5, 37);
      } else {
        const radius = zombie.getData('bodyRadius');
        const offset = zombie.getData('bodyOffset');
        zombie.body.setCircle(
          radius,
          32 - radius - Math.cos(angle) * offset,
          32 - radius - Math.sin(angle) * offset,
        );
      }
      zombie.setData('step', zombie.getData('step') + 0.12);
      const baseScale = zombie.getData('baseScale');
      zombie.setScale(baseScale, crawler ? baseScale : baseScale * (1 + Math.sin(zombie.getData('step')) * 0.025));
      const shadow = zombie.getData('shadow');
      shadow
        ?.setPosition(zombie.x + 2, zombie.y + (crawler ? 10 : 3))
        .setRotation(zombie.rotation);
      zombie.getData('aura')
        ?.setPosition(zombie.x, zombie.y)
        .setAlpha(0.16 + Math.max(0, Math.sin(time * 0.011 + zombie.getData('step'))) * 0.12);
      if (time >= zombie.getData('nextVoiceAt')) {
        this.monsterAudio.play(
          zombie.getData('type') as MonsterType,
          'ambient',
          zombie.x,
          zombie.y,
          this.player.x,
          this.player.y,
        );
        const voiceDelay = zombie.getData('type') === 'runner'
          ? Phaser.Math.Between(2100, 3700)
          : Phaser.Math.Between(2800, 5200);
        zombie.setData('nextVoiceAt', time + voiceDelay);
      }
    });

    const emberLights = this.zombies.getChildren()
      .filter((zombie) => zombie.active && zombie.getData('type') === 'charred')
      .map((zombie) => ({ x: zombie.x, y: zombie.y }));
    this.lighting.redraw(this.player.x, this.player.y, aim, this.collectShadowCasters(), emberLights);

    this.bullets.children.iterate((bullet) => {
      if (bullet?.active) {
        bullet.getData('glow')?.setPosition(bullet.x, bullet.y);
        this.tracers.lineBetween(
          bullet.x - Math.cos(bullet.rotation) * 24,
          bullet.y - Math.sin(bullet.rotation) * 24,
          bullet.x,
          bullet.y,
        );
      }
      if (bullet?.active && (bullet.x < -20 || bullet.x > WIDTH + 20 || bullet.y < -20 || bullet.y > HEIGHT + 20)) {
        this.destroyBullet(bullet);
      }
    });
  }

  private collectShadowCasters(): ShadowCaster[] {
    const casters: ShadowCaster[] = [];
    const addBody = (gameObject: Phaser.GameObjects.GameObject & {
      active: boolean;
      body?: Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody | null;
    }) => {
      const body = gameObject.body;
      if (!gameObject.active || !body?.enable) return;
      casters.push({
        x: body.center.x,
        y: body.center.y,
        radius: Math.max(6, body.halfWidth, body.halfHeight),
      });
    };

    addBody(this.player);
    this.zombies.getChildren()
      .filter((zombie) => zombie.active)
      .sort((a, b) => Phaser.Math.Distance.Squared(this.player.x, this.player.y, a.x, a.y)
        - Phaser.Math.Distance.Squared(this.player.x, this.player.y, b.x, b.y))
      .slice(0, 36)
      .forEach(addBody);
    this.solidProps.getChildren().forEach(addBody);
    this.barrels.getChildren().forEach(addBody);
    return casters;
  }

  shoot(angle, time) {
    this.lastShot = time;
    this.audio.playNoise(0.055, 0.075, 2100);
    this.audio.playTone(115, 0.065, 0.045);
    // The source art aims due south, with the muzzle on its lower centerline.
    const muzzleDistance = 29;
    const muzzleX = this.player.x + Math.cos(angle) * muzzleDistance;
    const muzzleY = this.player.y + Math.sin(angle) * muzzleDistance;
    const pointBlankZombie = this.findZombieBetweenPlayerAnd(muzzleX, muzzleY);
    const bullet = this.bullets.get(muzzleX, muzzleY, 'bullet');
    if (!bullet) return;
    bullet.enableBody(true, muzzleX, muzzleY, true, true);
    bullet.setDepth(8).setRotation(angle);
    bullet.body.setAllowGravity(false);
    const bulletGlow = this.add.image(muzzleX, muzzleY, 'glow')
      .setDepth(17)
      .setScale(0.18)
      .setTint(0xffc34d)
      .setAlpha(0.32)
      .setBlendMode(Phaser.BlendModes.ADD);
    bullet.setData('glow', bulletGlow);
    if (pointBlankZombie) {
      this.hitZombie(bullet, pointBlankZombie);
    } else {
      bullet.setVelocity(Math.cos(angle) * BULLET_SPEED, Math.sin(angle) * BULLET_SPEED);
    }

    const flash = this.add.image(muzzleX, muzzleY, 'flash')
      .setScale(1.8)
      .setRotation(angle)
      .setDepth(22)
      .setBlendMode(Phaser.BlendModes.ADD);
    const glow = this.add.image(muzzleX, muzzleY, 'glow')
      .setScale(1.05)
      .setDepth(21)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: [flash, glow], alpha: 0, scale: 0.2, duration: 75, onComplete: () => { flash.destroy(); glow.destroy(); } });

    const side = angle + Math.PI / 2;
    const casing = this.add.image(
      this.player.x + Math.cos(side) * 9,
      this.player.y + Math.sin(side) * 9,
      'casing',
    ).setDepth(7).setRotation(Phaser.Math.FloatBetween(0, Math.PI));
    this.tweens.add({
      targets: casing,
      x: casing.x + Math.cos(side) * Phaser.Math.Between(12, 20),
      y: casing.y + Math.sin(side) * Phaser.Math.Between(12, 20) + 5,
      angle: casing.angle + 180,
      alpha: 0,
      duration: 420,
      ease: 'Quad.out',
      onComplete: () => casing.destroy(),
    });

    this.player.x -= Math.cos(angle) * 1.4;
    this.player.y -= Math.sin(angle) * 1.4;
  }

  private findZombieBetweenPlayerAnd(x: number, y: number) {
    const line = new Phaser.Geom.Line(this.player.x, this.player.y, x, y);
    let closestZombie = null;
    let closestDistance = Infinity;

    this.zombies.children.iterate((zombie) => {
      if (!zombie?.active) return;
      const body = zombie.body as Phaser.Physics.Arcade.Body;
      if (!body?.enable) return;

      let intersections: Phaser.Geom.Point[];
      let startsInside: boolean;
      if (body.isCircle) {
        const circle = new Phaser.Geom.Circle(body.center.x, body.center.y, body.halfWidth);
        if (!Phaser.Geom.Intersects.LineToCircle(line, circle)) return;
        startsInside = Phaser.Geom.Circle.Contains(circle, this.player.x, this.player.y);
        intersections = Phaser.Geom.Intersects.GetLineToCircle(line, circle);
      } else {
        const rectangle = new Phaser.Geom.Rectangle(body.x, body.y, body.width, body.height);
        if (!Phaser.Geom.Intersects.LineToRectangle(line, rectangle)) return;
        startsInside = Phaser.Geom.Rectangle.Contains(rectangle, this.player.x, this.player.y);
        intersections = Phaser.Geom.Intersects.GetLineToRectangle(line, rectangle);
      }

      const distance = startsInside
        ? 0
        : Math.min(...intersections.map((point) => Phaser.Math.Distance.Squared(
          this.player.x,
          this.player.y,
          point.x,
          point.y,
        )));
      if (distance < closestDistance) {
        closestZombie = zombie;
        closestDistance = distance;
      }
    });

    return closestZombie;
  }

  private destroyBullet(bullet): void {
    bullet.getData('glow')?.destroy();
    bullet.setData('glow', null);
    bullet.destroy();
  }

  makeSparks(x, y, angle, amount = 5) {
    for (let i = 0; i < amount; i += 1) {
      const sparkAngle = angle + Math.PI + Phaser.Math.FloatBetween(-0.8, 0.8);
      const spark = this.add.image(x, y, 'dust')
        .setDepth(22)
        .setTint(0xffd171)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(Phaser.Math.Between(1, 2));
      const distance = Phaser.Math.Between(8, 24);
      this.tweens.add({
        targets: spark,
        x: x + Math.cos(sparkAngle) * distance,
        y: y + Math.sin(sparkAngle) * distance,
        alpha: 0,
        duration: Phaser.Math.Between(90, 180),
        onComplete: () => spark.destroy(),
      });
    }
  }

  playImpactEffect(kind: 'bullet-impact' | 'blood-hit', x: number, y: number, angle: number) {
    const effect = this.add.sprite(x, y, kind)
      .setDepth(23)
      .setRotation(angle)
      .setScale(kind === 'blood-hit' ? 1.15 : 1);
    effect.play(kind);
    effect.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => effect.destroy());
  }

  hitProp(bullet, prop) {
    if (!bullet.active || !prop.active) return;
    if (prop.getData('bulletPassThrough')) return;
    const impactAngle = bullet.rotation;
    const impactX = bullet.x;
    const impactY = bullet.y;
    const propX = prop.x;
    const propY = prop.y;
    this.destroyBullet(bullet);
    this.playImpactEffect('bullet-impact', impactX, impactY, impactAngle);
    this.makeSparks(impactX, impactY, impactAngle, 4);
    this.audio.playNoise(0.035, 0.026, 1800);

    const health = prop.getData('health');
    if (!health) return;
    prop.setData('health', health - 1).setTintFill(0xe6d4ad);
    this.time.delayedCall(55, () => prop.active && prop.clearTint());
    if (health > 1) return;

    const kind = prop.getData('kind');
    const lightIndex = prop.getData('lightIndex');
    prop.getData('shadow')?.destroy();
    prop.disableBody(true, false).setTint(0x463a31).setAlpha(0.68);
    this.makeSparks(propX, propY, impactAngle, 10);

    if (kind === 'generator') {
      prop.getData('beacon')?.setTint(0xff4f32).setAlpha(0.26);
      const marker = prop.getData('marker') as Phaser.GameObjects.Text | undefined;
      if (marker) {
        this.tweens.killTweensOf(marker);
        marker.setText('OUTPOST GENERATOR  •  OFFLINE').setColor('#ed5945').setAlpha(1);
        this.tweens.add({ targets: marker, alpha: 0, delay: 2200, duration: 1300 });
      }
      this.announce('GENERATOR DESTROYED', 'THE OUTPOST HAS GONE DARK');
      this.lighting.destroyGenerator();
      this.makeBlast(propX, propY, impactAngle, 100, 2);
    }
    if (kind === 'floodlight') {
      this.lighting.disableLight(lightIndex);
    }
  }

  hitBarrel(bullet, barrel) {
    if (!bullet.active || !barrel.active || barrel.getData('exploded')) return;
    const impactAngle = bullet.rotation;
    this.playImpactEffect('bullet-impact', bullet.x, bullet.y, impactAngle);
    this.makeSparks(bullet.x, bullet.y, impactAngle, 6);
    this.destroyBullet(bullet);
    const health = barrel.getData('health') - 1;
    barrel.setData('health', health).setTintFill(0xffc27b);
    if (health <= 0) {
      this.explodeBarrel(barrel, impactAngle);
    } else {
      this.time.delayedCall(70, () => barrel.active && barrel.clearTint());
    }
  }

  explodeBarrel(barrel, impactAngle = 0) {
    if (!barrel.active || barrel.getData('exploded')) return;
    barrel.setData('exploded', true);
    const { x, y } = barrel;
    barrel.getData('shadow')?.destroy();
    barrel.disableBody(true, true);
    this.makeBlast(x, y, impactAngle, 125, 3);

    this.barrels.getChildren().slice().forEach((other) => {
      if (!other.active || other.getData('exploded') || Phaser.Math.Distance.Between(x, y, other.x, other.y) > 145) return;
      this.time.delayedCall(110, () => this.explodeBarrel(other, Phaser.Math.Angle.Between(x, y, other.x, other.y)));
    });
    if (Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) < 108) this.damagePlayer(34);
  }

  spawnZombie(edge = Phaser.Math.Between(0, 3)) {
    if (this.isGameOver || this.zombies.countActive() >= 70) return;
    const pad = 38;
    let x;
    let y;
    if (edge === 0) { x = Phaser.Math.Between(0, WIDTH); y = -pad; }
    if (edge === 1) { x = WIDTH + pad; y = Phaser.Math.Between(0, HEIGHT); }
    if (edge === 2) { x = Phaser.Math.Between(0, WIDTH); y = HEIGHT + pad; }
    if (edge === 3) { x = -pad; y = Phaser.Math.Between(0, HEIGHT); }

    const roll = Phaser.Math.Between(0, 99);
    let type = {
      name: 'shambler', texture: 'zombie', health: 1, speed: Phaser.Math.Between(49, 66),
      scale: 1, tint: 0xffffff, bodyRadius: 12, bodyOffset: 8, shadowWidth: 38, shadowHeight: 16,
    };
    if (this.director.wave >= 2 && roll < 22) {
      type = {
        name: 'runner', texture: 'zombie-runner', health: 1, speed: Phaser.Math.Between(96, 116),
        scale: 1, tint: 0xffffff, bodyRadius: 11, bodyOffset: 8, shadowWidth: 34, shadowHeight: 14,
      };
    }
    if (this.director.wave >= 2 && roll >= 22 && roll < 36) {
      type = {
        name: 'crawler', texture: 'zombie-crawler', health: 1, speed: Phaser.Math.Between(38, 46),
        scale: 1, tint: 0xffffff, bodyRadius: 10, bodyOffset: 4, shadowWidth: 32, shadowHeight: 12,
      };
    }
    if (this.director.wave >= 3 && roll >= 80) {
      type = {
        name: 'brute', texture: 'zombie-brute', health: 3, speed: Phaser.Math.Between(39, 48),
        scale: 1, tint: 0xffffff, bodyRadius: 17, bodyOffset: 6, shadowWidth: 46, shadowHeight: 20,
      };
    }
    if (this.director.wave >= 4 && roll >= 45 && roll < 59) {
      type = {
        name: 'charred', texture: 'zombie-charred', health: 2, speed: Phaser.Math.Between(66, 78),
        scale: 1, tint: 0xffffff, bodyRadius: 13, bodyOffset: 7, shadowWidth: 40, shadowHeight: 17,
      };
    }

    const shadow = this.add.image(x + 2, y + (type.name === 'crawler' ? 10 : 3), 'soft-shadow')
      .setDepth(1)
      .setDisplaySize(type.shadowWidth * type.scale, type.shadowHeight * type.scale)
      .setAlpha(0);
    const aura = type.name === 'charred'
      ? this.add.image(x, y, 'glow')
        .setDepth(16)
        .setScale(0.5)
        .setTint(0xff6a24)
        .setAlpha(0.2)
        .setBlendMode(Phaser.BlendModes.ADD)
      : null;
    const zombie = this.zombies.create(x, y, type.texture).setDepth(3).setScale(type.scale).setTint(type.tint);
    if (type.name === 'crawler') {
      zombie.body.setSize(17, 10, false).setOffset(23.5, 37);
    } else {
      zombie.body.setCircle(type.bodyRadius, 32 - type.bodyRadius, 32 - type.bodyRadius);
    }
    zombie.setData({
      type: type.name,
      textureKey: type.texture,
      health: type.health,
      speed: type.speed + (type.name === 'crawler'
        ? Math.min(8, this.director.wave)
        : Math.min(25, this.director.wave * 2)),
      baseScale: type.scale,
      tint: type.tint,
      bodyRadius: type.bodyRadius,
      bodyOffset: type.bodyOffset,
      shadow,
      aura,
      step: Phaser.Math.FloatBetween(0, Math.PI * 2),
      staggerUntil: 0,
      nextVoiceAt: this.time.now + Phaser.Math.Between(900, 3600),
      nextPainVoiceAt: 0,
    });

    zombie.setAlpha(0);
    this.tweens.add({ targets: zombie, alpha: 1, duration: 260 });
    this.tweens.add({ targets: shadow, alpha: 0.34, duration: 260 });
    if (type.name !== 'shambler' || Phaser.Math.Between(0, 2) === 0) {
      this.monsterAudio.play(type.name as MonsterType, 'spawn', x, y, this.player.x, this.player.y);
    }
  }

  hitZombie(bullet, zombie) {
    if (!bullet.active || !zombie.active) return;
    const impactAngle = bullet.rotation;
    this.destroyBullet(bullet);
    const health = zombie.getData('health') - 1;
    zombie.setData('health', health);

    this.playImpactEffect('blood-hit', zombie.x, zombie.y, impactAngle);
    this.makeBlood(zombie.x, zombie.y, impactAngle, health <= 0 ? 7 : 3);
    this.audio.playNoise(health <= 0 ? 0.07 : 0.035, health <= 0 ? 0.045 : 0.025, 620);
    this.cameras.main.shake(45, health <= 0 ? 0.0018 : 0.0008);

    if (health > 0) {
      if (this.time.now >= zombie.getData('nextPainVoiceAt')) {
        this.monsterAudio.play(
          zombie.getData('type') as MonsterType,
          'hurt',
          zombie.x,
          zombie.y,
          this.player.x,
          this.player.y,
        );
        zombie.setData('nextPainVoiceAt', this.time.now + 520);
      }
      zombie.setTintFill(0xf0d6ae);
      zombie.setVelocity(Math.cos(impactAngle) * 130, Math.sin(impactAngle) * 130);
      zombie.setData('staggerUntil', this.time.now + 85);
      this.time.delayedCall(55, () => zombie.active && zombie.setTint(zombie.getData('tint')));
      return;
    }

    this.killZombie(zombie, impactAngle);
  }

  killZombie(zombie, impactAngle) {
    if (!zombie.active) return;
    const { x, y, rotation } = zombie;
    const type = zombie.getData('type');
    const baseScale = zombie.getData('baseScale');
    this.monsterAudio.play(type as MonsterType, 'death', x, y, this.player.x, this.player.y);
    this.score += 1;
    this.scoreText.setText(String(this.score).padStart(5, '0'));
    this.tweens.add({ targets: this.scoreText, scale: 1.16, duration: 55, yoyo: true });

    const corpse = this.add.image(x, y, zombie.getData('textureKey'))
      .setDepth(-1)
      .setRotation(rotation + Phaser.Math.FloatBetween(-0.22, 0.22))
      .setScale(baseScale, baseScale * 0.82)
      .setTint(0x51352f)
      .setAlpha(0.55);
    this.corpses.push(corpse);
    if (this.corpses.length > 22) this.corpses.shift()!.destroy();
    this.tweens.add({ targets: corpse, alpha: 0.18, delay: 11500, duration: 4500 });

    zombie.getData('shadow')?.destroy();
    zombie.getData('aura')?.destroy();
    zombie.destroy();

    if (type === 'charred') this.makeBlast(x, y, impactAngle);
  }

  makeBlast(x, y, impactAngle, radius = 76, damage = 2) {
    this.audio.playNoise(0.32, 0.13, 850);
    this.audio.playTone(72, 0.34, 0.09, 'sawtooth');
    const blastScale = radius / 76;
    this.lighting.addExplosionLight(x, y, radius);
    const glow = this.add.image(x, y, 'glow')
      .setDepth(22)
      .setScale(0.7 * blastScale)
      .setTint(0xff7426)
      .setAlpha(1)
      .setBlendMode(Phaser.BlendModes.ADD);
    const hotGlow = this.add.image(x, y, 'glow')
      .setDepth(22)
      .setScale(0.3 * blastScale)
      .setTint(0xffd15c)
      .setAlpha(1)
      .setBlendMode(Phaser.BlendModes.ADD);
    const explosion = this.add.sprite(x, y, 'explosion')
      .setDepth(23)
      .setScale(Phaser.Math.Clamp(blastScale * 1.45, 1.45, 2.55))
      .setRotation(Phaser.Math.RND.pick([0, Math.PI / 2, Math.PI, Math.PI * 1.5]));
    this.tweens.add({ targets: glow, scale: 3.1 * blastScale, alpha: 0, duration: 390, onComplete: () => glow.destroy() });
    this.tweens.add({ targets: hotGlow, scale: 1.8 * blastScale, alpha: 0, duration: 210, onComplete: () => hotGlow.destroy() });
    explosion.play('barrel-explosion');
    explosion.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => explosion.destroy());
    this.cameras.main.shake(140, 0.006 * blastScale);

    this.zombies.getChildren().slice().forEach((other) => {
      if (!other.active || Phaser.Math.Distance.Between(x, y, other.x, other.y) > radius) return;
      const angle = Phaser.Math.Angle.Between(x, y, other.x, other.y);
      const health = other.getData('health') - damage;
      other.setData('health', health);
      this.makeBlood(other.x, other.y, angle, 4);
      if (health <= 0) {
        this.killZombie(other, angle);
      } else {
        other.setVelocity(Math.cos(angle) * 220, Math.sin(angle) * 220);
        other.setData('staggerUntil', this.time.now + 160);
      }
    });
  }

  makeBlood(x, y, angle, amount) {
    const decal = this.add.image(x, y, 'blood')
      .setDepth(-2)
      .setScale(Phaser.Math.FloatBetween(1.1, 2.2))
      .setRotation(Phaser.Math.FloatBetween(0, Math.PI * 2))
      .setAlpha(0.58);
    this.bloodDecals.push(decal);
    if (this.bloodDecals.length > 45) this.bloodDecals.shift()!.destroy();

    for (let i = 0; i < amount; i += 1) {
      const sprayAngle = angle + Phaser.Math.FloatBetween(-0.65, 0.65);
      const drop = this.add.image(x, y, 'blood').setDepth(7).setScale(Phaser.Math.FloatBetween(0.25, 0.65));
      const distance = Phaser.Math.Between(10, 34);
      this.tweens.add({
        targets: drop,
        x: x + Math.cos(sprayAngle) * distance,
        y: y + Math.sin(sprayAngle) * distance,
        alpha: 0,
        duration: Phaser.Math.Between(180, 330),
        onComplete: () => drop.destroy(),
      });
    }
  }

  damagePlayer(amount) {
    if (this.time.now - this.lastHurt < 470 || this.isGameOver) return false;
    this.lastHurt = this.time.now;
    this.health = Math.max(0, this.health - amount);
    this.audio.playTone(68, 0.2, 0.07, 'sawtooth');
    this.healthBar.width = 34 * (this.health / 100);
    this.healthBar.setFillStyle(this.health <= 35 ? 0xd4513f : 0xd4d37b);
    this.player.setTintFill(0xffe6d3);
    this.time.delayedCall(90, () => this.player.clearTint());
    this.cameras.main.shake(160, 0.009);
    this.cameras.main.flash(80, 120, 18, 12, false);
    if (this.health <= 0) this.gameOver();
    return true;
  }

  healPlayer(amount: number) {
    const previousHealth = this.health;
    this.health = Math.min(100, this.health + amount);
    this.healthBar.setFillStyle(this.health <= 35 ? 0xd4513f : 0xd4d37b);
    this.tweens.add({
      targets: this.healthBar,
      width: 34 * (this.health / 100),
      duration: 380,
      ease: 'Quad.out',
    });
    if (this.health > previousHealth) {
      const healingVignette = this.add.image(WIDTH / 2, HEIGHT / 2, 'status-vignette')
        .setDepth(24)
        .setTint(0xa9ef9a)
        .setAlpha(0)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: healingVignette,
        alpha: 0.18,
        duration: 140,
        yoyo: true,
        hold: 100,
        onComplete: () => healingVignette.destroy(),
      });
      this.cameras.main.flash(110, 126, 220, 142, false);
    }
  }

  private updateStatusEffects(time: number): void {
    const remaining = this.supplies.adrenalineRemaining(time);
    const active = remaining > 0;
    if (active && !this.wasAdrenalineActive) {
      this.cameras.main.flash(120, 255, 111, 48, false);
      this.tweens.add({ targets: this.statusVignette, alpha: 0.2, duration: 160, yoyo: true });
    }
    this.wasAdrenalineActive = active;
    this.statusVignette.setAlpha(active ? 0.075 + Math.sin(time * 0.009) * 0.018 : 0);
    this.adrenalineText
      .setVisible(active)
      .setText(active ? `ADRENALINE  ${(remaining / 1000).toFixed(1)}s` : '');
  }

  hurtPlayer(_player, zombie) {
    if (!this.damagePlayer(18)) return;
    this.monsterAudio.play(
      zombie.getData('type') as MonsterType,
      'attack',
      zombie.x,
      zombie.y,
      this.player.x,
      this.player.y,
    );
    const angle = Phaser.Math.Angle.Between(zombie.x, zombie.y, this.player.x, this.player.y);
    zombie.setVelocity(-Math.cos(angle) * 180, -Math.sin(angle) * 180);
  }

  gameOver() {
    this.isGameOver = true;
    const survivalMs = this.time.now - this.startedAt;
    window.dispatchEvent(new CustomEvent('last-light:game-over', {
      detail: { score: this.score, survivalMs },
    }));
    this.announcementQueue = [];
    this.director.stop();
    this.player.setTint(0x8f4d44);
    this.cameras.main.shake(380, 0.015);
    this.cameras.main.zoomTo(1.045, 450, 'Sine.easeOut');

    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x050202, 0.88).setInteractive();
    const panel = this.add.rectangle(WIDTH / 2, HEIGHT / 2, 510, 324, 0x0c0b0b, 0.97)
      .setStrokeStyle(3, 0x962f27, 1);
    const inner = this.add.rectangle(WIDTH / 2, HEIGHT / 2, 494, 308)
      .setStrokeStyle(1, 0x4c211d, 1);
    const accent = this.add.rectangle(WIDTH / 2, HEIGHT / 2 - 154, 494, 5, 0xc44636, 1);
    const status = this.add.text(WIDTH / 2, HEIGHT / 2 - 126, 'OUTPOST LOST // SIGNAL TERMINATED', {
      fontFamily: '"Share Tech Mono", monospace',
      fontSize: '11px',
      color: '#d04d3d',
    }).setOrigin(0.5);
    const title = this.add.text(WIDTH / 2, HEIGHT / 2 - 82, 'OVERRUN', {
      fontFamily: '"Changa One", sans-serif',
      fontSize: '62px',
      color: '#d85242',
      stroke: '#3b100e',
      strokeThickness: 8,
    }).setOrigin(0.5).setScale(1.5);
    const survivalSeconds = Math.floor(survivalMs / 1000);
    const survivalTime = `${String(Math.floor(survivalSeconds / 60)).padStart(2, '0')}:${String(survivalSeconds % 60).padStart(2, '0')}`;
    const result = this.add.text(WIDTH / 2, HEIGHT / 2 - 20, `${this.score} HOSTILES  •  SURVIVED ${survivalTime}`, {
      fontFamily: '"Share Tech Mono", monospace',
      fontSize: '17px',
      color: '#d8cdc0',
    }).setOrigin(0.5);
    const rule = this.add.rectangle(WIDTH / 2, HEIGHT / 2 + 10, 390, 2, 0x7d2b24, 0.85);
    const redeployButton = this.makeOverlayButton(
      WIDTH / 2 - 106,
      HEIGHT / 2 + 60,
      196,
      'REDEPLOY',
      true,
      () => this.scene.restart(),
    );
    const menuButton = this.makeOverlayButton(
      WIDTH / 2 + 106,
      HEIGHT / 2 + 60,
      196,
      'MAIN MENU',
      false,
      () => this.returnToMenu(),
    );
    const footer = this.add.text(WIDTH / 2, HEIGHT / 2 + 127, 'THE LAST LIGHT // FIELD COMMAND', {
      fontFamily: '"Share Tech Mono", monospace',
      fontSize: '11px',
      color: '#81766f',
    }).setOrigin(0.5);
    const overlay = this.add.container(0, 0, [
      shade,
      panel,
      inner,
      accent,
      status,
      title,
      result,
      rule,
      ...redeployButton,
      ...menuButton,
      footer,
    ]).setDepth(50).setAlpha(0);
    this.tweens.add({ targets: overlay, alpha: 1, duration: 400 });
    this.tweens.add({ targets: title, scale: 1, duration: 430, ease: 'Back.out' });
  }
}
