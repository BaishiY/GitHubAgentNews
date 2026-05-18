import type { ClaudeSummary, EnrichedRepo } from "./types.js";

function buildAdaptiveCard(summary: ClaudeSummary, repos: EnrichedRepo[], date: string): Record<string, unknown> {
  const explosiveSection = repos
    .filter((r) => {
      const ageDays = (Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24);
      return ageDays < 30 && r.velocity > 30;
    })
    .slice(0, 3);

  const body: Record<string, unknown>[] = [
    {
      type: "TextBlock",
      text: `🤖 Agent 日报 - ${date}`,
      weight: "bolder",
      size: "large",
    },
  ];

  if (explosiveSection.length > 0) {
    body.push(
      {
        type: "TextBlock",
        text: "🔥 暴涨速报",
        weight: "bolder",
        separator: true,
      },
      {
        type: "FactSet",
        facts: explosiveSection.map((r) => {
          const ageDays = Math.floor((Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24));
          return {
            title: r.full_name,
            value: `⭐${r.stargazers_count} (创建${ageDays}天, ${r.velocity.toFixed(0)}⭐/天) ${r.fireLevel}`,
          };
        }),
      }
    );
  }

  const sections = splitSummary(summary.raw);

  if (sections.top5) {
    body.push(
      {
        type: "TextBlock",
        text: "⭐ Top 5 值得关注",
        weight: "bolder",
        separator: true,
      },
      {
        type: "TextBlock",
        text: sections.top5,
        wrap: true,
        size: "small",
      }
    );
  }

  if (sections.trend) {
    body.push(
      {
        type: "TextBlock",
        text: "📊 趋势观察",
        weight: "bolder",
        separator: true,
      },
      {
        type: "TextBlock",
        text: sections.trend,
        wrap: true,
      }
    );
  }

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          type: "AdaptiveCard",
          version: "1.4",
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          body,
          actions: [
            {
              type: "Action.OpenUrl",
              title: "查看 GitHub Trending",
              url: "https://github.com/trending",
            },
          ],
        },
      },
    ],
  };
}

function splitSummary(raw: string): { top5: string; explosive: string; trend: string } {
  const top5Match = raw.match(/## 任务1[\s\S]*?(?=## 任务2|$)/);
  const explosiveMatch = raw.match(/## 任务2[\s\S]*?(?=## 任务3|$)/);
  const trendMatch = raw.match(/## 任务3[\s\S]*$/);

  const clean = (s: string | undefined) =>
    (s ?? "")
      .replace(/^## 任务\d[：:][^\n]*\n*/m, "")
      .trim();

  return {
    top5: clean(top5Match?.[0]),
    explosive: clean(explosiveMatch?.[0]),
    trend: clean(trendMatch?.[0]),
  };
}

export async function sendToTeams(
  summary: ClaudeSummary,
  repos: EnrichedRepo[]
): Promise<void> {
  const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log("[Teams] TEAMS_WEBHOOK_URL not set, printing card to console instead:");
    const date = new Date().toISOString().slice(0, 10);
    const card = buildAdaptiveCard(summary, repos, date);
    console.log(JSON.stringify(card, null, 2));
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const card = buildAdaptiveCard(summary, repos, date);

  console.log("[Teams] Sending Adaptive Card...");

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(card),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Teams webhook error (${res.status}): ${body}`);
  }

  console.log("[Teams] Message sent successfully");
}
