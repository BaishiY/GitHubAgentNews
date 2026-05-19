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

export type SearchGroup = "A" | "B" | "C" | "D" | "R";

export interface EnrichedRepo extends RepoInfo {
  source: SearchGroup[];
  velocity: number;
  velocitySource: "snapshot" | "lifetime";
  dailyStarsDelta: number | null;
  acceleration: number | null;
  score: number;
  radarBoost: number;
  radarMatchScore: number;
  matchedSignal?: RadarSignal;
  matchedHeadline?: string;
  readmeSnippet?: string;
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
  whyNow?: string;
  linkedSignal?: string;
  linkedSignalUrl?: string;
  linkedSignalHeadline?: string;
  radarBoost?: string;
  dailyStars?: string;
}

export interface ClaudeSummary {
  top5: RepoSummaryItem[];
  explosiveRepos: RepoSummaryItem[];
  trendObservation: string;
  raw: string;
}

export interface TrendingRepo {
  fullName: string;
  htmlUrl: string;
  description: string;
  language: string | null;
  dailyStars: number | null;
}

export interface RadarSignal {
  id: string;
  label: string;
  count: number;
  searchTerms: string[];
  sampleTitle: string;
  sampleUrl: string;
  siteName: string;
  source: string;
}

export interface RadarTopSite {
  siteId: string;
  siteName: string;
  count: number;
}

export interface RadarContext {
  generatedAt: string;
  overview: string;
  dynamicSearchTerms: string[];
  topSignals: RadarSignal[];
  topSites: RadarTopSite[];
  sourceHealth: {
    successfulSites: number;
    totalSites: number;
    failedSites: string[];
    aiItems: number;
    rawItems: number;
  };
}

export interface SearchGroupConfig {
  group: SearchGroup;
  query: string;
  minStars: number;
  useCreatedDate: boolean;
  perPage: number;
}
