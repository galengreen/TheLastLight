import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config/constants';
import type { AudioSystem } from './AudioSystem';
import type { LightingSystem } from './LightingSystem';

interface FlareHooks {
  isGeneratorOnline: () => boolean;
  isGameOver: () => boolean;
  announce: (title: string, subtitle: string) => void;
}

export class FlareSystem {
  private readonly capacity = 2;
  private readonly rechargeDuration = 45000;
  private readonly firstChargeDuration = 38000;
  private readonly key: Phaser.Input.Keyboard.Key;
  private readonly inventoryText: Phaser.GameObjects.Text;
  private readonly chargeText: Phaser.GameObjects.Text;
  private charges = 0;
  private rechargeElapsed = 0;
  private unlocked = false;
  private lastUpdate = 0;
  private activeUntil = 0;
  private launching = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly player: Phaser.Physics.Arcade.Sprite,
    private readonly lighting: LightingSystem,
    private readonly audio: AudioSystem,
    private readonly hooks: FlareHooks,
  ) {
    this.key = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    const textStyle = {
      fontFamily: '"Share Tech Mono", monospace',
      color: '#e2c690',
      backgroundColor: '#090c0acc',
      padding: { x: 5, y: 2 },
    };
    this.inventoryText = scene.add.text(GAME_WIDTH - 25, 58, '', {
      ...textStyle,
      fontSize: '13px',
    }).setOrigin(1, 0).setDepth(30);
    this.chargeText = scene.add.text(GAME_WIDTH - 25, 78, '', {
      ...textStyle,
      fontSize: '10px',
      color: '#a99d83',
    }).setOrigin(1, 0).setDepth(30);
    this.refreshHud();
  }

  update(time: number, aimAngle: number): void {
    const elapsed = this.lastUpdate === 0 ? 0 : Math.min(100, time - this.lastUpdate);
    this.lastUpdate = time;

    if (this.charges < this.capacity && this.hooks.isGeneratorOnline()) {
      this.rechargeElapsed += elapsed;
      const duration = this.unlocked ? this.rechargeDuration : this.firstChargeDuration;
      if (this.rechargeElapsed >= duration) {
        this.rechargeElapsed -= duration;
        this.charges += 1;
        if (!this.unlocked) {
          this.unlocked = true;
          this.hooks.announce('AERIAL FLARE READY', 'GENERATOR FABRICATED ONE • PRESS F TO FIRE');
        } else {
          this.hooks.announce('FLARE FABRICATED', 'AERIAL FLARE CHARGE ADDED');
        }
      }
    }

    if (Phaser.Input.Keyboard.JustDown(this.key)) this.fire(aimAngle, time);
    this.refreshHud();
  }

  canAddCharge(): boolean {
    return this.charges < this.capacity;
  }

  addCharge(): boolean {
    if (!this.canAddCharge()) return false;
    this.charges += 1;
    this.unlocked = true;
    this.rechargeElapsed = 0;
    this.refreshHud();
    return true;
  }

  private fire(angle: number, time: number): void {
    if (this.hooks.isGameOver() || this.charges <= 0 || this.launching || time < this.activeUntil) return;
    this.charges -= 1;
    this.launching = true;
    this.audio.playTone(186, 0.42, 0.055, 'sawtooth');
    this.audio.playNoise(0.38, 0.045, 1300);

    const startX = this.player.x + Math.cos(angle) * 28;
    const startY = this.player.y + Math.sin(angle) * 28;
    const targetX = Phaser.Math.Clamp(this.player.x + Math.cos(angle) * 175, 110, GAME_WIDTH - 110);
    const targetY = Phaser.Math.Clamp(this.player.y + Math.sin(angle) * 145, 145, GAME_HEIGHT - 70);
    const airborneY = targetY - 92;
    const projectile = this.scene.add.image(startX, startY, 'flare-cartridge')
      .setDepth(23)
      .setRotation(angle)
      .setScale(1.15);
    const glow = this.scene.add.image(startX, startY, 'glow')
      .setDepth(22)
      .setScale(0.24)
      .setTint(0xff321c)
      .setAlpha(0.75)
      .setBlendMode(Phaser.BlendModes.ADD);
    const trail = this.scene.add.graphics().setDepth(21).setBlendMode(Phaser.BlendModes.ADD);

    this.scene.tweens.add({
      targets: projectile,
      x: targetX,
      y: airborneY,
      scale: 0.28,
      duration: 650,
      ease: 'Quad.out',
      onUpdate: () => {
        glow.setPosition(projectile.x, projectile.y).setScale(0.2 + projectile.scale * 0.16);
        trail.clear().lineStyle(2, 0xff5933, 0.7).lineBetween(startX, startY, projectile.x, projectile.y);
      },
      onComplete: () => {
        projectile.destroy();
        glow.destroy();
        trail.destroy();
        this.ignite(targetX, targetY);
      },
    });
  }

  private ignite(x: number, y: number): void {
    const duration = 14000;
    const airborneY = y - 92;
    this.launching = false;
    this.activeUntil = this.scene.time.now + duration;
    this.lighting.igniteAerialFlare(x, airborneY, duration);
    this.audio.playNoise(0.7, 0.055, 2200);
    this.audio.playTone(420, 0.5, 0.035, 'triangle');
    this.scene.cameras.main.flash(120, 255, 48, 24, false);
  }

  private refreshHud(): void {
    this.inventoryText.setVisible(this.unlocked);
    if (!this.unlocked) return;

    const slots = Array.from({ length: this.capacity }, (_, index) => index < this.charges ? '◆' : '◇').join('');
    this.inventoryText.setText(`F  AERIAL FLARES  ${slots}`);
    const generatorOnline = this.hooks.isGeneratorOnline();
    this.chargeText.setVisible(generatorOnline);
    if (!generatorOnline) return;

    if (this.charges >= this.capacity) {
      this.chargeText.setText('GENERATOR FABRICATOR  •  STANDBY').setColor('#a99d83');
    } else {
      const percent = Math.floor((this.rechargeElapsed / this.rechargeDuration) * 100);
      this.chargeText.setText(`GENERATOR FABRICATOR  •  ${String(percent).padStart(2, '0')}%`).setColor('#a99d83');
    }
  }
}
