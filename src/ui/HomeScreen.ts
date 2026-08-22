import {
  flushPendingScores,
  getChangelog,
  getLeaderboard,
  getStatus,
  type ChangelogEntry,
  type LeaderboardEntry,
} from '../api/client';
import {
  hasTouchControls,
  loadMobileControlScheme,
  setMobileControlScheme,
  type MobileControlScheme,
} from '../config/controls';
import lastNightAliveUrl from '../assets/audio/Last Night Alive.mp3';
import lastNightAliveAlternateUrl from '../assets/audio/Last Night Alive-2.mp3';

interface HomeScreenOptions {
  onDeploy: (callsign: string, mobileControlScheme: MobileControlScheme) => void;
}

const CALLSIGN_KEY = 'the-last-light-callsign';
const HOME_MUSIC_VOLUME = 0.16;
const HOME_MUSIC_TRACKS = [lastNightAliveUrl, lastNightAliveAlternateUrl];

export class HomeScreen {
  private readonly callsign = element<HTMLInputElement>('callsign');
  private readonly notice = element<HTMLElement>('home-notice');
  private mobileControlScheme = loadMobileControlScheme();
  private menuMusic?: HTMLAudioElement;
  private menuFadeFrame?: number;
  private menuUnlockHandler?: () => void;

  constructor(private readonly options: HomeScreenOptions) {
    document.documentElement.classList.toggle('touch-controls-available', hasTouchControls());
    this.callsign.value = localStorage.getItem(CALLSIGN_KEY) ?? '';
    element<HTMLFormElement>('deploy-form').addEventListener('submit', (event) => this.deploy(event));
    document.querySelectorAll<HTMLInputElement>('input[name="mobile-control-scheme"]').forEach((input) => {
      input.checked = input.value === this.mobileControlScheme;
      input.addEventListener('change', () => {
        if (input.checked && (input.value === 'drag-aim' || input.value === 'twin-stick')) {
          this.mobileControlScheme = input.value;
        }
      });
    });
    element('how-to-button').addEventListener('click', () => this.openModal('how-to-modal'));
    element('leaderboard-button').addEventListener('click', () => void this.openLeaderboard());
    element('changelog-button').addEventListener('click', () => void this.openChangelog());
    document.querySelectorAll<HTMLElement>('[data-close-modal]').forEach((button) => {
      button.addEventListener('click', () => button.closest('.modal')?.classList.add('hidden'));
    });
    document.querySelectorAll<HTMLElement>('.modal').forEach((modal) => {
      modal.addEventListener('pointerdown', (event) => {
        if (event.target === modal) modal.classList.add('hidden');
      });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') document.querySelectorAll('.modal').forEach((modal) => modal.classList.add('hidden'));
    });
    void this.refreshStatus();
    this.startMenuMusic();
  }

  show(): void {
    this.notice.textContent = '';
    document.querySelectorAll('.modal').forEach((modal) => modal.classList.add('hidden'));
    void this.refreshStatus();
    this.startMenuMusic();
  }

  private deploy(event: SubmitEvent): void {
    event.preventDefault();
    const callsign = [...this.callsign.value.trim().replace(/\s+/g, ' ')].slice(0, 18).join('');
    if ([...callsign].length < 2) {
      this.notice.textContent = 'ENTER A CALLSIGN TO DEPLOY';
      this.callsign.focus();
      return;
    }
    localStorage.setItem(CALLSIGN_KEY, callsign);
    setMobileControlScheme(this.mobileControlScheme);
    this.fadeOutMenuMusic();
    this.options.onDeploy(callsign, this.mobileControlScheme);
  }

  private startMenuMusic(): void {
    this.stopMenuMusic();
    const audio = new Audio(HOME_MUSIC_TRACKS[Math.floor(Math.random() * HOME_MUSIC_TRACKS.length)]);
    audio.loop = true;
    audio.volume = HOME_MUSIC_VOLUME;
    this.menuMusic = audio;
    void audio.play().catch(() => {
      if (this.menuMusic !== audio) return;
      this.menuUnlockHandler = () => {
        this.removeMenuUnlockHandler();
        if (this.menuMusic === audio) void audio.play().catch(() => undefined);
      };
      document.addEventListener('pointerdown', this.menuUnlockHandler, { once: true });
      document.addEventListener('keydown', this.menuUnlockHandler, { once: true });
    });
  }

  private fadeOutMenuMusic(): void {
    this.removeMenuUnlockHandler();
    const audio = this.menuMusic;
    if (!audio) return;
    if (this.menuFadeFrame !== undefined) cancelAnimationFrame(this.menuFadeFrame);
    const startedAt = performance.now();
    const startingVolume = audio.volume;
    const fade = (time: number) => {
      const progress = Math.min(1, (time - startedAt) / 800);
      audio.volume = startingVolume * (1 - progress);
      if (progress < 1) {
        this.menuFadeFrame = requestAnimationFrame(fade);
        return;
      }
      audio.pause();
      audio.currentTime = 0;
      if (this.menuMusic === audio) this.menuMusic = undefined;
      this.menuFadeFrame = undefined;
    };
    this.menuFadeFrame = requestAnimationFrame(fade);
  }

  private stopMenuMusic(): void {
    this.removeMenuUnlockHandler();
    if (this.menuFadeFrame !== undefined) {
      cancelAnimationFrame(this.menuFadeFrame);
      this.menuFadeFrame = undefined;
    }
    this.menuMusic?.pause();
    this.menuMusic = undefined;
  }

  private removeMenuUnlockHandler(): void {
    if (!this.menuUnlockHandler) return;
    document.removeEventListener('pointerdown', this.menuUnlockHandler);
    document.removeEventListener('keydown', this.menuUnlockHandler);
    this.menuUnlockHandler = undefined;
  }

  private async refreshStatus(): Promise<void> {
    try {
      const status = await getStatus();
      element('play-count').textContent = status.playCount.toLocaleString();
      element('last-update').textContent = formatUpdate(status.lastUpdate);
    } catch {
      element('play-count').textContent = 'OFFLINE';
      element('last-update').textContent = 'LOCAL BUILD';
    }
  }

  private async openLeaderboard(): Promise<void> {
    this.openModal('leaderboard-modal');
    const rows = element('leaderboard-rows');
    rows.textContent = 'RETRIEVING FIELD RECORDS...';
    try {
      await flushPendingScores();
      const entries = await getLeaderboard();
      rows.replaceChildren(...(entries.length ? entries.map(leaderboardRow) : [messageRow('NO SURVIVORS RECORDED YET')]));
    } catch {
      rows.replaceChildren(messageRow('FIELD ARCHIVE UNAVAILABLE'));
    }
  }

  private async openChangelog(): Promise<void> {
    this.openModal('changelog-modal');
    const rows = element('changelog-rows');
    rows.textContent = 'RETRIEVING TRANSMISSIONS...';
    try {
      const changelog = await getChangelog();
      rows.replaceChildren(...(changelog.entries.length
        ? changelog.entries.map(changelogRow)
        : [messageRow('NO TRANSMISSIONS RECORDED')]));
    } catch {
      rows.replaceChildren(messageRow('TRANSMISSION LOST'));
    }
  }

  private openModal(id: string): void {
    document.querySelectorAll('.modal').forEach((modal) => modal.classList.add('hidden'));
    element(id).classList.remove('hidden');
  }
}

function leaderboardRow(entry: LeaderboardEntry, index: number): HTMLElement {
  const row = document.createElement('div');
  const eliminations = text('strong', String(entry.score).padStart(5, '0'));
  eliminations.className = 'leaderboard-score';
  row.className = `leaderboard-row${index === 0 ? ' first' : ''}`;
  row.append(
    text('span', String(index + 1).padStart(2, '0')),
    text('strong', entry.name),
    eliminations,
    text('span', entry.threat === null ? '--' : String(entry.threat).padStart(2, '0')),
    text('span', formatDuration(entry.survivalMs)),
    text('span', formatLeaderboardDate(entry.achievedAt)),
  );
  return row;
}

function changelogRow(entry: ChangelogEntry): HTMLElement {
  const link = document.createElement('a');
  link.className = 'changelog-row';
  link.href = entry.url;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.append(
    text('code', entry.sha.slice(0, 7)),
    text('strong', entry.message),
    text('time', entry.date ? new Date(entry.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '--'),
  );
  return link;
}

function messageRow(message: string): HTMLElement {
  const row = text('p', message);
  row.className = 'empty-row';
  return row;
}

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatLeaderboardDate(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '--';
  const day = String(date.getDate()).padStart(2, '0');
  const month = date.toLocaleString(undefined, { month: 'short' }).toUpperCase();
  return `${day} ${month} ${String(date.getFullYear()).slice(-2)}`;
}

function formatUpdate(value: string | null): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value as T;
}
