import { readFile } from 'node:fs/promises';

export interface ChangelogEntry {
  sha: string;
  message: string;
  url: string;
  date: string | null;
}

export interface Changelog {
  generatedAt: string | null;
  repository: string;
  entries: ChangelogEntry[];
}

const DEFAULT_REPOSITORY = 'AlexanderHeffernan/TheLastLight';

export class ChangelogStore {
  private changelog: Changelog;

  constructor(
    private readonly fallbackPath: URL,
    private readonly repository = process.env.CHANGELOG_REPOSITORY || DEFAULT_REPOSITORY,
  ) {
    this.changelog = { generatedAt: null, repository: this.repository, entries: [] };
  }

  async load(): Promise<void> {
    await this.loadFallback();
    try {
      const response = await fetch(`https://api.github.com/repos/${this.repository}/commits?per_page=8`, {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'TheLastLight-server',
          ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
        },
      });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      const commits = await response.json();
      if (!Array.isArray(commits)) throw new Error('Unexpected GitHub response');
      this.changelog = {
        generatedAt: new Date().toISOString(),
        repository: this.repository,
        entries: commits.map(entryFromCommit).filter((entry): entry is ChangelogEntry => entry !== null),
      };
    } catch (error) {
      console.warn(`Could not refresh changelog: ${errorMessage(error)}`);
    }
  }

  current(): Changelog {
    return this.changelog;
  }

  private async loadFallback(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.fallbackPath, 'utf8')) as Changelog;
      if (Array.isArray(parsed.entries)) this.changelog = parsed;
    } catch {
      // The checked-in build artifact is only a fallback for GitHub outages.
    }
  }
}

function entryFromCommit(value: unknown): ChangelogEntry | null {
  if (!value || typeof value !== 'object') return null;
  const commit = value as {
    sha?: unknown;
    html_url?: unknown;
    commit?: { message?: unknown; committer?: { date?: unknown }; author?: { date?: unknown } };
  };
  const sha = String(commit.sha ?? '').slice(0, 12);
  const message = String(commit.commit?.message ?? '').split(/\r?\n/)[0].trim();
  const url = String(commit.html_url ?? '');
  if (!sha || !message || !url) return null;
  const date = commit.commit?.committer?.date ?? commit.commit?.author?.date;
  return { sha, message, url, date: typeof date === 'string' ? date : null };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
