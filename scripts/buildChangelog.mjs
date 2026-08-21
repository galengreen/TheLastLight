import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = process.env.CHANGELOG_REPOSITORY || 'AlexanderHeffernan/TheLastLight';
const outputPath = fileURLToPath(new URL('../public/changelog.json', import.meta.url));
const changelog = { generatedAt: new Date().toISOString(), repository, entries: [] };

try {
  const response = await fetch(`https://api.github.com/repos/${repository}/commits?per_page=8`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'TheLastLight-build',
      ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  const commits = await response.json();
  if (Array.isArray(commits)) {
    changelog.entries = commits.map((commit) => ({
      sha: String(commit.sha ?? '').slice(0, 12),
      message: String(commit.commit?.message ?? '').split(/\r?\n/)[0].trim(),
      url: String(commit.html_url ?? ''),
      date: commit.commit?.committer?.date ?? commit.commit?.author?.date ?? null,
    })).filter((entry) => entry.sha && entry.message && entry.url);
  }
} catch (error) {
  console.warn(`Could not build changelog: ${error instanceof Error ? error.message : String(error)}`);
  changelog.generatedAt = null;
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(changelog, null, 2)}\n`);
