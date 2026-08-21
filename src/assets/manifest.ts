import Phaser from 'phaser';
import soldierUrl from './characters/soldier.png';
import zombieUrl from './characters/zombie.png';
import zombieRunnerUrl from './enemies/zombie_runner_64.png';
import zombieBruteUrl from './enemies/zombie_brute_64.png';
import zombieCharredUrl from './enemies/zombie_charred_64.png';
import zombieCrawlerUrl from './enemies/zombie_crawler_64.png';
import groundAUrl from './ground/wasteland-a.png';
import groundBUrl from './ground/wasteland-b.png';
import groundCUrl from './ground/wasteland-c.png';
import groundDUrl from './ground/wasteland-d.png';
import barrelUrl from './props/explosive_barrel_64.png';
import generatorUrl from './props/field_generator_64.png';
import floodlightUrl from './props/floodlight_64.png';
import sandbagsUrl from './props/sandbag_barricade_64.png';
import treeTrunkUrl from './props/dead_tree_trunk_64.png';
import treeCanopyUrl from './props/dead_tree_canopy_128.png';
import wreckedVehicleUrl from './props/wrecked_military_vehicle_128.png';
import explosionUrl from './effects/barrel_explosion_64_sheet.png';
import bulletImpactUrl from './effects/bullet_impact_32_sheet.png';
import bloodHitUrl from './effects/blood_hit_32_sheet.png';
import supplyCacheClosedUrl from './supplies/supply_cache_closed_64.png';
import supplyCacheOpenUrl from './supplies/supply_cache_open_64.png';
import medkitUrl from './supplies/medkit_pickup_64.png';
import adrenalineUrl from './supplies/adrenaline_pickup_64.png';
import ashesAtDawnUrl from './audio/ashes-at-dawn.mp3';
import lastBarricadeUrl from './audio/Last Barricade.mp3';
import lastBarricadeAlternateUrl from './audio/Last Barricade-2.mp3';

const musicTracks = [
  ['music-ashes-at-dawn', ashesAtDawnUrl],
  ['music-last-barricade', lastBarricadeUrl],
  ['music-last-barricade-alternate', lastBarricadeAlternateUrl],
] as const;

export const MUSIC_KEYS = musicTracks.map(([key]) => key);

export function loadAssets(scene: Phaser.Scene): void {
  scene.load.image('soldier', soldierUrl);
  scene.load.image('zombie', zombieUrl);
  scene.load.image('zombie-runner', zombieRunnerUrl);
  scene.load.image('zombie-brute', zombieBruteUrl);
  scene.load.image('zombie-charred', zombieCharredUrl);
  scene.load.image('zombie-crawler', zombieCrawlerUrl);
  scene.load.image('ground-a', groundAUrl);
  scene.load.image('ground-b', groundBUrl);
  scene.load.image('ground-c', groundCUrl);
  scene.load.image('ground-d', groundDUrl);
  scene.load.image('barrel', barrelUrl);
  scene.load.image('generator', generatorUrl);
  scene.load.image('floodlight', floodlightUrl);
  scene.load.image('sandbags', sandbagsUrl);
  scene.load.image('tree-trunk', treeTrunkUrl);
  scene.load.image('tree-canopy', treeCanopyUrl);
  scene.load.image('wrecked-vehicle', wreckedVehicleUrl);
  scene.load.image('supply-cache-closed', supplyCacheClosedUrl);
  scene.load.image('supply-cache-open', supplyCacheOpenUrl);
  scene.load.image('medkit', medkitUrl);
  scene.load.image('adrenaline', adrenalineUrl);
  scene.load.spritesheet('explosion', explosionUrl, { frameWidth: 64, frameHeight: 64 });
  scene.load.spritesheet('bullet-impact', bulletImpactUrl, { frameWidth: 32, frameHeight: 32 });
  scene.load.spritesheet('blood-hit', bloodHitUrl, { frameWidth: 32, frameHeight: 32 });
  musicTracks.forEach(([key, url]) => scene.load.audio(key, url));
}
