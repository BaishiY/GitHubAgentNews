import type { RepoInfo, SearchGroup, SearchGroupConfig, QualityCheck } from "./types.js";
import { buildDynamicSearchQuery } from "./radar.js";
import { createLimiter, fetchWithRetry } from "./http.js";

type SearchResultItem = { repo: RepoInfo; sources: SearchGroup[]; qualityCheck?: QualityCheck; readmeSnippet?: string };

const GITHUB_API = "https://api.github.com";
const token = process.env.GITHUB_TOKEN ?? "";
const scheduleGitHubRequest = createLimiter(Number.parseInt(process.env.GITHUB_MAX_CONCURRENCY ?? "4", 10) || 4);

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

function buildSearchGroups(dynamicTerms: string[] = []): SearchGroupConfig[] {
  const yesterday = formatDate(1);
  const thirtyDaysAgo = formatDate(30);

  const groups: SearchGroupConfig[] = [
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

  const dynamicQuery = buildDynamicSearchQuery(dynamicTerms);
  if (dynamicQuery) {
    groups.push({
      group: "R",
      query: dynamicQuery,
      minStars: 80,
      useCreatedDate: false,
      perPage: 30,
    });
  }

  return groups;
}

async function requestGitHubResponse(url: string, label: string, init?: RequestInit): Promise<Response> {
  return scheduleGitHubRequest(async () => {
    const response = await fetchWithRetry(url, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } }, label);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API error (${response.status}) for ${label}: ${body}`);
    }

    return response;
  });
}

async function requestGitHubJson<T>(url: string, label: string, init?: RequestInit): Promise<T> {
  const response = await requestGitHubResponse(url, label, init);
  return (await response.json()) as T;
}

async function requestGitHubText(url: string, label: string, init?: RequestInit): Promise<string> {
  const response = await requestGitHubResponse(url, label, init);
  return response.text();
}

function getPagedCount(response: Response, fallbackCount: number): number {
  const lastPageMatch = response.headers.get("link")?.match(/page=(\d+)>; rel="last"/);
  if (lastPageMatch?.[1]) {
    return Number.parseInt(lastPageMatch[1], 10);
  }

  return fallbackCount;
}

async function searchRepos(config: SearchGroupConfig): Promise<{ group: SearchGroup; repos: RepoInfo[] }> {
  const url = new URL(`${GITHUB_API}/search/repositories`);
  url.searchParams.set("q", config.query);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", String(config.perPage));

  console.log(`[Search ${config.group}] ${config.query.slice(0, 80)}...`);

  const data = await requestGitHubJson<{ items: RepoInfo[] }>(url.toString(), `search group ${config.group}`);
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
  const [languages, commitsRes, contributorsRes] = await Promise.all([
    requestGitHubJson<Record<string, number>>(
      `${GITHUB_API}/repos/${repo.full_name}/languages`,
      `languages ${repo.full_name}`
    ),
    requestGitHubResponse(`${GITHUB_API}/repos/${repo.full_name}/commits?per_page=1`, `commits ${repo.full_name}`),
    requestGitHubResponse(
      `${GITHUB_API}/repos/${repo.full_name}/contributors?per_page=1&anon=true`,
      `contributors ${repo.full_name}`
    ),
  ]);

  const commits = (await commitsRes.json()) as Array<{ commit: { committer: { date: string } } }>;
  const contributors = (await contributorsRes.json()) as Array<unknown>;
  const contributorCount = getPagedCount(contributorsRes, contributors.length);
  const commitCount = getPagedCount(commitsRes, commits.length);
  const lastCommitDate = commits[0]?.commit?.committer?.date ?? null;
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

async function fetchReadmeSnippet(repo: RepoInfo): Promise<string | undefined> {
  try {
    const text = await requestGitHubText(`${GITHUB_API}/repos/${repo.full_name}/readme`, `readme ${repo.full_name}`, {
      headers: {
        Accept: "application/vnd.github.raw+json",
      },
    });

    return text.replace(/[#>*_`\-\[\]\(\)!]/g, " ").replace(/\s+/g, " ").trim().slice(0, 400) || undefined;
  } catch {
    return undefined;
  }
}

function passesQualityCheck(qc: QualityCheck, repo: RepoInfo): boolean {
  return (
    qc.commits >= 10 &&
    repo.size >= 100 &&
    repo.open_issues_count > 0 &&
    repo.forks_count >= 5 &&
    qc.contributors >= 2 &&
    qc.hasRealCode &&
    qc.recentCommit
  );
}

export async function searchAllGroups(dynamicTerms: string[] = []): Promise<SearchResultItem[]> {
  const configs = buildSearchGroups(dynamicTerms);

  const settledSearches = await Promise.allSettled(configs.map((config) => searchRepos(config)));
  const results = settledSearches.flatMap((result) => {
    if (result.status === "fulfilled") {
      return [result.value];
    }

    console.warn(`[Search] Skipping failed search group: ${String(result.reason)}`);
    return [];
  });

  if (results.length === 0) {
    throw new Error("All GitHub search groups failed");
  }

  const merged = dedupeAndFilter(results);
  console.log(`[Dedup] ${merged.length} unique repos after filtering`);

  const settledRepos = await Promise.allSettled(
    merged.map(async (item): Promise<SearchResultItem | null> => {
      const isGroupD = item.sources.includes("D");

      if (isGroupD) {
        const [qc, readmeSnippet] = await Promise.all([checkQuality(item.repo), fetchReadmeSnippet(item.repo)]);
        if (passesQualityCheck(qc, item.repo)) {
          return { ...item, qualityCheck: qc, readmeSnippet };
        }

        console.log(`[Quality] Filtered out ${item.repo.full_name} (empty/low-quality)`);
        return null;
      }

      const readmeSnippet = await fetchReadmeSnippet(item.repo);
      return { ...item, readmeSnippet };
    })
  );

  const output = settledRepos.flatMap((result) => {
    if (result.status === "fulfilled") {
      return result.value ? [result.value] : [];
    }

    console.warn(`[Repo] Skipping repo after GitHub API failure: ${String(result.reason)}`);
    return [];
  });

  console.log(`[Final] ${output.length} repos passed all filters`);
  return output;
}
