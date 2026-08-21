export interface GameStatus {
  playCount: number;
  lastUpdate: string | null;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  score: number;
  survivalMs: number;
  achievedAt: number;
}

export interface ChangelogEntry {
  sha: string;
  message: string;
  url: string;
  date: string | null;
}

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

export function submitScore(name: string, score: number, survivalMs: number): Promise<{ ok: true }> {
  return request('/api/leaderboard', {
    method: 'POST',
    body: JSON.stringify({ name, score, survivalMs }),
  });
}

export function getChangelog(): Promise<{ repository: string; entries: ChangelogEntry[] }> {
  return request('/api/changelog');
}
