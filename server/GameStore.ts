import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface LeaderboardEntry {
  id: string;
  name: string;
  score: number;
  survivalMs: number;
  achievedAt: number;
}

interface GameData {
  playCount: number;
  leaderboard: LeaderboardEntry[];
}

const EMPTY_DATA: GameData = { playCount: 0, leaderboard: [] };

export class GameStore {
  private data: GameData = structuredClone(EMPTY_DATA);
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<GameData>;
      this.data = {
        playCount: validInteger(parsed.playCount, 0, Number.MAX_SAFE_INTEGER) ?? 0,
        leaderboard: Array.isArray(parsed.leaderboard)
          ? parsed.leaderboard.filter(isLeaderboardEntry).sort(compareScores).slice(0, 20)
          : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`Could not load game data: ${errorMessage(error)}`);
      }
    }
  }

  status(): { playCount: number } {
    return { playCount: this.data.playCount };
  }

  entries(): LeaderboardEntry[] {
    return this.data.leaderboard.map((entry) => ({ ...entry }));
  }

  recordPlay(): number {
    this.data.playCount += 1;
    this.queueSave();
    return this.data.playCount;
  }

  submit(name: unknown, score: unknown, survivalMs: unknown): LeaderboardEntry | null {
    const normalizedName = normalizeName(name);
    const normalizedScore = validInteger(score, 0, 100000);
    const normalizedSurvival = validInteger(survivalMs, 1000, 24 * 60 * 60 * 1000);
    if (!normalizedName || normalizedScore === null || normalizedSurvival === null) return null;

    const entry: LeaderboardEntry = {
      id: randomUUID(),
      name: normalizedName,
      score: normalizedScore,
      survivalMs: normalizedSurvival,
      achievedAt: Date.now(),
    };
    this.data.leaderboard.push(entry);
    this.data.leaderboard.sort(compareScores);
    this.data.leaderboard = this.data.leaderboard.slice(0, 20);
    this.queueSave();
    return entry;
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  private queueSave(): void {
    const snapshot = `${JSON.stringify(this.data, null, 2)}\n`;
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true });
        const temporaryPath = `${this.path}.${process.pid}.tmp`;
        await writeFile(temporaryPath, snapshot, 'utf8');
        await rename(temporaryPath, this.path);
      })
      .catch((error: unknown) => {
        console.error(`Could not persist game data: ${errorMessage(error)}`);
      });
  }
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ').replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 18);
  return normalized.length >= 2 ? normalized : null;
}

function validInteger(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function compareScores(left: LeaderboardEntry, right: LeaderboardEntry): number {
  return right.score - left.score
    || right.survivalMs - left.survivalMs
    || left.achievedAt - right.achievedAt;
}

function isLeaderboardEntry(value: unknown): value is LeaderboardEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as LeaderboardEntry;
  return typeof entry.id === 'string'
    && normalizeName(entry.name) === entry.name
    && validInteger(entry.score, 0, 100000) !== null
    && validInteger(entry.survivalMs, 1000, 24 * 60 * 60 * 1000) !== null
    && validInteger(entry.achievedAt, 0, Number.MAX_SAFE_INTEGER) !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
