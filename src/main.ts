import Phaser from 'phaser';
import './style.css';
import { flushPendingScores, queueScore, recordPlay } from './api/client';
import { GAME_HEIGHT, GAME_WIDTH } from './config/constants';
import { gameConfig } from './config/game';
import { HomeScreen } from './ui/HomeScreen';

let game: Phaser.Game | undefined;
let callsign = 'SURVIVOR';
const mobileRotationGames = new WeakSet<Phaser.Game>();
let orientationNoticeTimeout: number | undefined;

const ORIENTATION_NOTICE_DURATION_MS = 2_000;

const homeScreen = new HomeScreen({
  onDeploy: (name) => {
    callsign = name;
    document.querySelector('#home')?.classList.add('hidden');
    document.querySelector('#game-shell')?.classList.remove('hidden');
    showOrientationNoticeBriefly();
    game ??= new Phaser.Game(gameConfig);
    installMobileRotationSupport(game);
  },
});

function showOrientationNoticeBriefly(): void {
  const orientationNotice = document.querySelector<HTMLElement>('#orientation-notice');
  if (!orientationNotice) return;

  orientationNotice.classList.remove('hidden');
  window.clearTimeout(orientationNoticeTimeout);
  orientationNoticeTimeout = window.setTimeout(() => {
    orientationNotice.classList.add('hidden');
    orientationNoticeTimeout = undefined;
  }, ORIENTATION_NOTICE_DURATION_MS);
}

function isRotatedMobileViewport(): boolean {
  return window.matchMedia('(max-width: 720px) and (orientation: portrait)').matches;
}

function installMobileRotationSupport(activeGame: Phaser.Game): void {
  if (mobileRotationGames.has(activeGame)) return;
  mobileRotationGames.add(activeGame);

  const scale = activeGame.scale;
  const input = activeGame.input;
  const originalGetParentBounds = scale.getParentBounds.bind(scale);
  const originalUpdateCenter = scale.updateCenter.bind(scale);
  const originalTransformPointer = input.transformPointer.bind(input);

  scale.getParentBounds = () => {
    if (!isRotatedMobileViewport()) return originalGetParentBounds();

    const parent = activeGame.canvas?.parentElement;
    if (!parent) return false;

    const width = parent.clientWidth;
    const height = parent.clientHeight;
    if (scale.parentSize.width === width && scale.parentSize.height === height) return false;

    scale.parentSize.setSize(width, height);
    return true;
  };

  scale.updateCenter = () => {
    if (!isRotatedMobileViewport() || !activeGame.canvas) {
      originalUpdateCenter();
      return;
    }

    const canvas = activeGame.canvas;
    const offsetX = Math.floor((scale.parentSize.width - canvas.offsetWidth) / 2);
    const offsetY = Math.floor((scale.parentSize.height - canvas.offsetHeight) / 2);
    canvas.style.marginLeft = `${offsetX}px`;
    canvas.style.marginTop = `${offsetY}px`;
  };

  input.transformPointer = (pointer, pageX, pageY, wasMove) => {
    if (!isRotatedMobileViewport() || !activeGame.canvas) {
      originalTransformPointer(pointer, pageX, pageY, wasMove);
      return;
    }

    const rect = activeGame.canvas.getBoundingClientRect();
    const clientX = pageX - window.scrollX;
    const clientY = pageY - window.scrollY;
    const x = ((clientY - rect.top) / rect.height) * GAME_WIDTH;
    const y = ((rect.right - clientX) / rect.width) * GAME_HEIGHT;
    const previous = pointer.position;
    const previousX = previous.x;
    const previousY = previous.y;

    pointer.prevPosition.set(previousX, previousY);
    if (!wasMove || pointer.smoothFactor === 0) {
      previous.set(x, y);
    } else {
      const factor = pointer.smoothFactor;
      previous.set(
        x * factor + previousX * (1 - factor),
        y * factor + previousY * (1 - factor),
      );
    }
  };

  const setInitialParentSize = () => {
    const parent = activeGame.canvas?.parentElement;
    if (!parent) return;
    scale.setParentSize(parent.clientWidth || GAME_WIDTH, parent.clientHeight || GAME_HEIGHT);
  };

  if (activeGame.canvas) {
    setInitialParentSize();
  } else {
    activeGame.events.once('boot', setInitialParentSize);
  }
}

window.addEventListener('last-light:run-start', () => {
  void recordPlay().catch(() => undefined);
});

window.addEventListener('last-light:game-over', (event) => {
  const result = (event as CustomEvent<{
    score: number;
    survivalMs: number;
    threat: number;
    runId: string;
  }>).detail;
  void queueScore(callsign, result.score, result.survivalMs, result.threat)
    .then((rank) => window.dispatchEvent(new CustomEvent('last-light:leaderboard-result', {
      detail: { runId: result.runId, rank, available: true },
    })))
    .catch(() => window.dispatchEvent(new CustomEvent('last-light:leaderboard-result', {
      detail: { runId: result.runId, rank: null, available: false },
    })));
});

window.addEventListener('online', () => void flushPendingScores().catch(() => undefined));
void flushPendingScores().catch(() => undefined);

window.addEventListener('last-light:return-menu', () => {
  // Let Phaser finish dispatching the button event before tearing down its input system.
  window.setTimeout(() => {
    game?.destroy(true);
    game = undefined;
    document.querySelector('#game-shell')?.classList.add('hidden');
    document.querySelector('#home')?.classList.remove('hidden');
    homeScreen.show();
  }, 0);
});
