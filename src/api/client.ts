export interface GameStatus {
  playCount: number;
  lastUpdate: string | null;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  score: number;
  survivalMs: number;
  threat: number | null;
  achievedAt: number;
}

export interface ChangelogEntry {
  sha: string;
  message: string;
  url: string;
  date: string | null;
}

interface PendingScore {
  submissionId: string;
  name: string;
  score: number;
  survivalMs: number;
  threat?: number;
}

const PENDING_SCORES_KEY = 'the-last-light-pending-scores';
let flushPromise: Promise<void> | undefined;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...options?.headers },
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export function getStatus(): Promise<GameStatus> {
  return request('/api/status');
}

export function recordPlay(): Promise<GameStatus> {
  return request('/api/plays', { method: 'POST', body: '{}' });
}

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const response = await request<{ entries: LeaderboardEntry[] }>('/api/leaderboard');
  return response.entries;
}

export function submitScore(
  name: string,
  score: number,
  survivalMs: number,
  threat?: number,
  submissionId: string = crypto.randomUUID(),
): Promise<{ ok: true }> {
  return request('/api/leaderboard', {
    method: 'POST',
    body: JSON.stringify({ name, score, survivalMs, threat, submissionId }),
    keepalive: true,
  });
}

export async function queueScore(name: string, score: number, survivalMs: number, threat: number): Promise<number | null> {
  const pending = { submissionId: crypto.randomUUID(), name, score, survivalMs: Math.round(survivalMs), threat };
  try {
    const scores = readPendingScores();
    scores.push(pending);
    writePendingScores(scores);
  } catch {
    await submitScore(name, score, survivalMs, threat, pending.submissionId);
    return leaderboardRank(pending.submissionId);
  }
  await flushPendingScores();
  return leaderboardRank(pending.submissionId);
}

export function flushPendingScores(): Promise<void> {
  flushPromise ??= flushScores().finally(() => {
    flushPromise = undefined;
  });
  return flushPromise;
}

async function flushScores(): Promise<void> {
  while (true) {
    const score = readPendingScores()[0];
    if (!score) return;
    await submitScore(score.name, score.score, score.survivalMs, score.threat, score.submissionId);
    const scores = readPendingScores();
    const submitted = scores.findIndex((entry) => sameScore(entry, score));
    if (submitted >= 0) {
      scores.splice(submitted, 1);
      writePendingScores(scores);
    }
  }
}

function readPendingScores(): PendingScore[] {
  const stored = localStorage.getItem(PENDING_SCORES_KEY);
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter(isPendingScore) : [];
  } catch {
    localStorage.removeItem(PENDING_SCORES_KEY);
    return [];
  }
}

function writePendingScores(scores: PendingScore[]): void {
  if (scores.length) localStorage.setItem(PENDING_SCORES_KEY, JSON.stringify(scores));
  else localStorage.removeItem(PENDING_SCORES_KEY);
}

function isPendingScore(value: unknown): value is PendingScore {
  if (!value || typeof value !== 'object') return false;
  const score = value as PendingScore;
  return typeof score.submissionId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(score.submissionId)
    && typeof score.name === 'string'
    && typeof score.score === 'number'
    && Number.isInteger(score.score)
    && score.score >= 0
    && score.score <= 100000
    && typeof score.survivalMs === 'number'
    && Number.isInteger(score.survivalMs)
    && score.survivalMs >= 0
    && score.survivalMs <= 24 * 60 * 60 * 1000
    && (score.threat === undefined
      || (Number.isInteger(score.threat) && score.threat >= 1 && score.threat <= 10000));
}

function sameScore(left: PendingScore, right: PendingScore): boolean {
  return left.submissionId === right.submissionId;
}

async function leaderboardRank(submissionId: string): Promise<number | null> {
  const entries = await getLeaderboard();
  const index = entries.findIndex((entry) => entry.id === submissionId);
  return index < 0 ? null : index + 1;
}

export function getChangelog(): Promise<{ repository: string; entries: ChangelogEntry[] }> {
  return request('/api/changelog');
}
