import "dotenv/config";
import { searchAllGroups, supplementCandidates } from "./github.js";
import { loadRadarContext } from "./radar.js";
import { enrichAndRank } from "./scorer.js";
import { loadSnapshot, saveSnapshot } from "./snapshot.js";
import { summarize } from "./summarize.js";
import { sendToTeams } from "./teams.js";
import { fetchTrendingRepos } from "./trending.js";
import type { TrendingRepo } from "./types.js";

async function main() {
  console.log("=== GitHub Agent 日报 ===");
  console.log(`Date: ${new Date().toISOString().slice(0, 10)}\n`);

  // 1. 加载历史快照
  const snapshot = await loadSnapshot();
  const snapshotDays = Object.keys(snapshot).length;
  console.log(`[Snapshot] Loaded ${snapshotDays} days of history\n`);

  // 2. 拉取外部新闻雷达上下文
  let radarContext = null;
  let trendingRepos: TrendingRepo[] = [];
  try {
    radarContext = await loadRadarContext();
    console.log(`[Radar] Loaded ${radarContext.topSignals.length} signals from external news radar`);
  } catch (error) {
    console.warn(`[Radar] Failed to load external radar context: ${String(error)}`);
  }

  try {
    trendingRepos = await fetchTrendingRepos(5);
    console.log(`[Trending] Loaded top ${trendingRepos.length} GitHub trending repos`);
  } catch (error) {
    console.warn(`[Trending] Failed to load GitHub trending repos: ${String(error)}`);
  }

  // 3. 搜索 GitHub（固定关键词 + 动态新闻主题 + 去重）
  const candidates = await searchAllGroups(radarContext?.dynamicSearchTerms ?? []);

  if (candidates.length === 0) {
    console.log("No repos found after filtering. Exiting.");
    return;
  }

  // 4. 先粗排，再只补 Top 候选的 README / 质量信息
  const preliminaryRanked = enrichAndRank(candidates, snapshot, radarContext ?? undefined, candidates.length);
  const preliminaryMap = new Map(candidates.map((item) => [item.repo.full_name, item]));
  const orderedCandidates = preliminaryRanked
    .map((repo) => preliminaryMap.get(repo.full_name))
    .filter((item): item is NonNullable<typeof item> => item !== undefined);
  const { supplemented, droppedRepoNames } = await supplementCandidates(orderedCandidates, 15);

  if (droppedRepoNames.length > 0) {
    console.log(`[Supplement] Dropped ${droppedRepoNames.length} low-quality top candidates`);
  }

  // 5. 评分排序，取 Top 20
  const ranked = enrichAndRank(supplemented, snapshot, radarContext ?? undefined, 20);
  console.log(`\n[Ranked] Top ${ranked.length} repos:`);
  for (const r of ranked.slice(0, 5)) {
    console.log(`  ${r.full_name} ⭐${r.stargazers_count} score=${r.score.toFixed(1)} ${r.fireLevel}`);
  }

  // 6. Claude 摘要
  const summary = await summarize(ranked, trendingRepos, radarContext ?? undefined);

  // 7. 推送到 Teams
  await sendToTeams(summary, ranked, snapshot, trendingRepos, radarContext ?? undefined);

  // 8. 保存今日快照
  const allRepos = candidates.map((f) => f.repo);
  await saveSnapshot(allRepos, snapshot);

  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
