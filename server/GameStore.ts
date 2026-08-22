import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validatePlayerName } from '../src/shared/nameValidator.js';

export interface LeaderboardEntry {
  id: string;
  name: string;
  score: number;
  survivalMs: number;
  threat: number | null;
  achievedAt: number;
}

interface GameData {
  playCount: number;
  leaderboard: LeaderboardEntry[];
}

const EMPTY_DATA: GameData = { playCount: 0, leaderboard: [] };
const LEADERBOARD_LIMIT = 10;

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
          ? parsed.leaderboard
            .map(normalizeLeaderboardEntry)
            .filter((entry): entry is LeaderboardEntry => entry !== null)
            .sort(compareScores)
            .slice(0, LEADERBOARD_LIMIT)
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
    void this.queueSave().catch(() => undefined);
    return this.data.playCount;
  }

  async submit(
    name: unknown,
    score: unknown,
    survivalMs: unknown,
    threat: unknown,
    submissionId?: unknown,
  ): Promise<LeaderboardEntry | null> {
    const nameResult = validatePlayerName(name);
    const normalizedScore = validInteger(score, 0, 100000);
    const normalizedSurvival = validDuration(survivalMs);
    const normalizedThreat = threat === undefined || threat === null ? null : validInteger(threat, 1, 10000);
    const entryId = submissionId === undefined ? randomUUID() : validSubmissionId(submissionId);
    if (!nameResult.ok
      || normalizedScore === null
      || normalizedSurvival === null
      || (threat !== undefined && threat !== null && normalizedThreat === null)
      || !entryId) return null;

    const existing = this.data.leaderboard.find((candidate) => candidate.id === entryId);
    if (existing) {
      await this.queueSave();
      return existing;
    }

    const entry: LeaderboardEntry = {
      id: entryId,
      name: nameResult.name,
      score: normalizedScore,
      survivalMs: normalizedSurvival,
      threat: normalizedThreat,
      achievedAt: Date.now(),
    };
    this.data.leaderboard.push(entry);
    this.data.leaderboard.sort(compareScores);
    this.data.leaderboard = this.data.leaderboard.slice(0, LEADERBOARD_LIMIT);
    await this.queueSave();
    return this.data.leaderboard.find((candidate) => candidate.id === entry.id) ?? entry;
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  private queueSave(): Promise<void> {
    const snapshot = `${JSON.stringify(this.data, null, 2)}\n`;
    const operation = this.writeQueue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temporaryPath = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporaryPath, snapshot, 'utf8');
      await rename(temporaryPath, this.path);
    });
    this.writeQueue = operation.catch((error: unknown) => {
      console.error(`Could not persist game data: ${errorMessage(error)}`);
    });
    return operation;
  }
}

function validInteger(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function validDuration(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 24 * 60 * 60 * 1000
    ? Math.round(value)
    : null;
}

function compareScores(left: LeaderboardEntry, right: LeaderboardEntry): number {
  return right.score - left.score
    || right.survivalMs - left.survivalMs
    || left.achievedAt - right.achievedAt;
}

function validSubmissionId(value: unknown): string | null {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function normalizeLeaderboardEntry(value: unknown): LeaderboardEntry | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as LeaderboardEntry;
  const name = validatePlayerName(entry.name);
  const threat = entry.threat === undefined || entry.threat === null
    ? null
    : validInteger(entry.threat, 1, 10000);
  if (typeof entry.id !== 'string'
    || !name.ok
    || name.name !== entry.name
    || validInteger(entry.score, 0, 100000) === null
    || validDuration(entry.survivalMs) !== entry.survivalMs
    || (entry.threat !== undefined && entry.threat !== null && threat === null)
    || validInteger(entry.achievedAt, 0, Number.MAX_SAFE_INTEGER) === null) return null;
  return { ...entry, threat };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
