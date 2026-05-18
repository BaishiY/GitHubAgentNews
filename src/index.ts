import { searchAllGroups } from "./github.js";
import { enrichAndRank } from "./scorer.js";
import { loadSnapshot, saveSnapshot } from "./snapshot.js";
import { summarize } from "./summarize.js";
import { sendToTeams } from "./teams.js";

async function main() {
  console.log("=== GitHub Agent 日报 ===");
  console.log(`Date: ${new Date().toISOString().slice(0, 10)}\n`);

  // 1. 加载历史快照
  const snapshot = await loadSnapshot();
  const snapshotDays = Object.keys(snapshot).length;
  console.log(`[Snapshot] Loaded ${snapshotDays} days of history\n`);

  // 2. 搜索 GitHub（4组关键词 + 去重 + 质量校验）
  const filtered = await searchAllGroups();

  if (filtered.length === 0) {
    console.log("No repos found after filtering. Exiting.");
    return;
  }

  // 3. 评分排序，取 Top 20
  const ranked = enrichAndRank(filtered, snapshot, 20);
  console.log(`\n[Ranked] Top ${ranked.length} repos:`);
  for (const r of ranked.slice(0, 5)) {
    console.log(`  ${r.full_name} ⭐${r.stargazers_count} score=${r.score.toFixed(1)} ${r.fireLevel}`);
  }

  // 4. Claude 摘要
  const summary = await summarize(ranked);

  // 5. 推送到 Teams
  await sendToTeams(summary, ranked);

  // 6. 保存今日快照
  const allRepos = filtered.map((f) => f.repo);
  await saveSnapshot(allRepos, snapshot);

  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
