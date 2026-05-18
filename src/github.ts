import type { RepoInfo, SearchGroup, SearchGroupConfig, QualityCheck } from "./types.js";

const GITHUB_API = "https://api.github.com";
const token = process.env.GITHUB_TOKEN ?? "";

const headers: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

function formatDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function buildSearchGroups(): SearchGroupConfig[] {
  const yesterday = formatDate(1);
  const thirtyDaysAgo = formatDate(30);

  return [
    {
      group: "A",
      query: `(agent OR ai-agent OR autonomous-agent) in:name,description,topics pushed:>${yesterday} stars:>100`,
      minStars: 100,
      useCreatedDate: false,
      perPage: 30,
    },
    {
      group: "B",
      query: `(agent-framework OR agentic OR llm-agent) in:name,description,topics pushed:>${yesterday} stars:>100`,
      minStars: 100,
      useCreatedDate: false,
      perPage: 30,
    },
    {
      group: "C",
      query: `(copilot OR assistant OR mcp OR tool-use OR function-calling) in:name,description,topics pushed:>${yesterday} stars:>100`,
      minStars: 100,
      useCreatedDate: false,
      perPage: 30,
    },
    {
      group: "D",
      query: `(agent OR ai-agent OR llm OR framework) in:name,description,topics created:>${thirtyDaysAgo} stars:>200`,
      minStars: 200,
      useCreatedDate: true,
      perPage: 50,
    },
  ];
}

async function searchRepos(config: SearchGroupConfig): Promise<{ group: SearchGroup; repos: RepoInfo[] }> {
  const url = new URL(`${GITHUB_API}/search/repositories`);
  url.searchParams.set("q", config.query);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", String(config.perPage));

  console.log(`[Search ${config.group}] ${config.query.slice(0, 80)}...`);

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub Search API error (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { items: RepoInfo[] };
  console.log(`[Search ${config.group}] Found ${data.items.length} repos`);
  return { group: config.group, repos: data.items };
}

function dedupeAndFilter(
  groupResults: { group: SearchGroup; repos: RepoInfo[] }[]
): { repo: RepoInfo; sources: SearchGroup[] }[] {
  const repoMap = new Map<number, { repo: RepoInfo; sources: SearchGroup[] }>();

  for (const { group, repos } of groupResults) {
    for (const repo of repos) {
      if (repo.fork || repo.archived || !repo.description) continue;
      if (repo.stargazers_count < 100) continue;

      const existing = repoMap.get(repo.id);
      if (existing) {
        existing.sources.push(group);
      } else {
        repoMap.set(repo.id, { repo, sources: [group] });
      }
    }
  }

  return Array.from(repoMap.values());
}

export async function checkQuality(repo: RepoInfo): Promise<QualityCheck> {
  const [repoDetail, languages, commitsRes] = await Promise.all([
    fetch(`${GITHUB_API}/repos/${repo.full_name}`, { headers }).then((r) => r.json()) as Promise<Record<string, unknown>>,
    fetch(`${GITHUB_API}/repos/${repo.full_name}/languages`, { headers }).then((r) => r.json()) as Promise<Record<string, number>>,
    fetch(`${GITHUB_API}/repos/${repo.full_name}/commits?per_page=1`, { headers }),
  ]);

  const contributorsRes = await fetch(
    `${GITHUB_API}/repos/${repo.full_name}/contributors?per_page=1&anon=true`,
    { headers }
  );
  const contributorCount = parseInt(contributorsRes.headers.get("link")?.match(/page=(\d+)>; rel="last"/)?.[1] ?? "1", 10);

  const commitCount = parseInt(commitsRes.headers.get("link")?.match(/page=(\d+)>; rel="last"/)?.[1] ?? "1", 10);

  const lastCommitDate = commitsRes.ok
    ? ((await commitsRes.json()) as Array<{ commit: { committer: { date: string } } }>)[0]?.commit?.committer?.date
    : null;
  const recentCommit = lastCommitDate
    ? Date.now() - new Date(lastCommitDate).getTime() < 7 * 24 * 60 * 60 * 1000
    : false;

  return {
    commits: commitCount,
    contributors: contributorCount,
    hasRealCode: Object.keys(languages).length > 0,
    recentCommit,
  };
}

function passesQualityCheck(qc: QualityCheck, repo: RepoInfo): boolean {
  return (
    qc.commits >= 10 &&
    repo.size >= 100 &&
    repo.forks_count >= 5 &&
    qc.contributors >= 2 &&
    qc.hasRealCode
  );
}

export async function searchAllGroups(): Promise<{ repo: RepoInfo; sources: SearchGroup[]; qualityCheck?: QualityCheck }[]> {
  const configs = buildSearchGroups();

  const results = [];
  for (const config of configs) {
    results.push(await searchRepos(config));
    await sleep(2000);
  }

  const merged = dedupeAndFilter(results);
  console.log(`[Dedup] ${merged.length} unique repos after filtering`);

  const output: { repo: RepoInfo; sources: SearchGroup[]; qualityCheck?: QualityCheck }[] = [];

  for (const item of merged) {
    const isGroupD = item.sources.includes("D");

    if (isGroupD) {
      const qc = await checkQuality(item.repo);
      if (passesQualityCheck(qc, item.repo)) {
        output.push({ ...item, qualityCheck: qc });
      } else {
        console.log(`[Quality] Filtered out ${item.repo.full_name} (empty/low-quality)`);
      }
    } else {
      output.push(item);
    }
  }

  console.log(`[Final] ${output.length} repos passed all filters`);
  return output;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
