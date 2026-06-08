/**
 * Telegram is the primary (and currently only) notification channel — free,
 * a single `fetch` POST, and perfectly suited to a single-user internal tool.
 * Email was considered (per the plan) but deferred as YAGNI; this module's
 * single `notify` entry point is the seam to add a channel later if needed.
 */
export async function notify(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn("[notify] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not configured — dropping message:", message);
    return;
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" }),
  });

  if (!response.ok) {
    console.error("[notify] Telegram sendMessage failed", response.status, await response.text().catch(() => ""));
  }
}
