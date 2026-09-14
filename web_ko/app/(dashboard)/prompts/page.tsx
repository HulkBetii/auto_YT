import { ensureDefaultPrompts, getActivePrompt, listPromptVersions } from "@/lib/db/repo/prompts";
import { formatDate } from "@/lib/ui";

import { PromptEditor } from "./PromptEditor";

export const dynamic = "force-dynamic";

export default async function PromptsPage() {
  await ensureDefaultPrompts();
  const [sourceAudit, outline, section, fidelityReview, history] = await Promise.all([
    getActivePrompt("source_audit"),
    getActivePrompt("outline"),
    getActivePrompt("section"),
    getActivePrompt("fidelity_review"),
    listPromptVersions(),
  ]);
  if (!sourceAudit || !outline || !section || !fidelityReview) throw new Error("Default prompts could not be initialized.");
  return <div className="space-y-7"><header><p className="eyebrow">Versioned inputs</p><h1 className="display mt-2 text-4xl font-bold">Prompt điều khiển</h1><p className="muted mt-3 max-w-3xl text-sm leading-7">Video mới chốt đủ bốn cổng prompt. Video đang chạy và các lần retry giữ nguyên snapshot cũ.</p></header><div className="grid gap-6 xl:grid-cols-2"><PromptEditor promptKey="source_audit" template={sourceAudit.template} version={sourceAudit.version} /><PromptEditor promptKey="outline" template={outline.template} version={outline.version} /><PromptEditor promptKey="section" template={section.template} version={section.version} /><PromptEditor promptKey="fidelity_review" template={fidelityReview.template} version={fidelityReview.version} /></div><section className="paper-card p-6"><h2 className="display text-2xl font-bold">Lịch sử phiên bản</h2><div className="table-wrap mt-4"><table><thead><tr><th>Prompt</th><th>Version</th><th>Active</th><th>Lý do</th><th>Thời điểm</th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td className="font-black">{item.promptKey}</td><td>v{item.version}</td><td>{item.isActive ? "Có" : "—"}</td><td className="muted text-xs">{item.changeReason ?? "—"}</td><td className="muted whitespace-nowrap text-xs">{formatDate(item.createdAt)}</td></tr>)}</tbody></table></div></section></div>;
}
