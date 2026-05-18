export interface RepoInfo {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  created_at: string;
  pushed_at: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  size: number;
  language: string | null;
  fork: boolean;
  archived: boolean;
  topics: string[];
}

export type SearchGroup = "A" | "B" | "C" | "D";

export interface EnrichedRepo extends RepoInfo {
  source: SearchGroup[];
  velocity: number;
  acceleration: number | null;
  score: number;
  fireLevel: string;
  qualityCheck?: QualityCheck;
}

export interface QualityCheck {
  commits: number;
  contributors: number;
  hasRealCode: boolean;
  recentCommit: boolean;
}

export interface StarsSnapshot {
  [date: string]: {
    [repoName: string]: number;
  };
}

export interface RepoSummaryItem {
  name: string;
  stars: string;
  velocity: string;
  fireLevel: string;
  tags: string;
  summary: string;
}

export interface ClaudeSummary {
  top5: RepoSummaryItem[];
  explosiveRepos: RepoSummaryItem[];
  trendObservation: string;
  raw: string;
}

export interface SearchGroupConfig {
  group: SearchGroup;
  query: string;
  minStars: number;
  useCreatedDate: boolean;
  perPage: number;
}
