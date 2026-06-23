const CHANNEL_PREFIX = "🌃 <b>[Drifter 2077]</b>";

export async function notify(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn("[notify] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not configured — dropping:", message);
    return;
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `${CHANNEL_PREFIX} ${message}`,
      parse_mode: "HTML",
    }),
  });

  if (!response.ok) {
    console.error("[notify] Telegram sendMessage failed", response.status, await response.text().catch(() => ""));
  }
}
