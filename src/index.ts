import "dotenv/config";
import { searchAllGroups } from "./github.js";
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

  // 3. 搜索 GitHub（固定关键词 + 动态新闻主题 + 去重 + 质量校验）
  const filtered = await searchAllGroups(radarContext?.dynamicSearchTerms ?? []);

  if (filtered.length === 0) {
    console.log("No repos found after filtering. Exiting.");
    return;
  }

  // 4. 评分排序，取 Top 20
  const ranked = enrichAndRank(filtered, snapshot, radarContext ?? undefined, 20);
  console.log(`\n[Ranked] Top ${ranked.length} repos:`);
  for (const r of ranked.slice(0, 5)) {
    console.log(`  ${r.full_name} ⭐${r.stargazers_count} score=${r.score.toFixed(1)} ${r.fireLevel}`);
  }

  // 5. Claude 摘要
  const summary = await summarize(ranked, trendingRepos, radarContext ?? undefined);

  // 6. 推送到 Teams
  await sendToTeams(summary, ranked, snapshot, trendingRepos, radarContext ?? undefined);

  // 7. 保存今日快照
  const allRepos = filtered.map((f) => f.repo);
  await saveSnapshot(allRepos, snapshot);

  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
