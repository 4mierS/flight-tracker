import { env } from "../env";
import type { FlightOffer } from "../providers/types";
import type { AlertKind } from "@prisma/client";

const TELEGRAM_API = "https://api.telegram.org";

/** Low-level send. Returns true on success; logs and returns false on failure. */
export async function sendTelegramMessage(text: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: false,
        }),
      },
    );
    if (!res.ok) {
      console.error(`Telegram sendMessage failed: HTTP ${res.status}`, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Telegram sendMessage threw:", err);
    return false;
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Format a deal alert for an offer. */
export async function sendDealAlert(args: {
  kind: AlertKind;
  watchLabel: string;
  offer: FlightOffer;
  previousBest: number | null;
}): Promise<boolean> {
  const { kind, watchLabel, offer, previousBest } = args;

  const heading = kind === "NEW_LOW" ? "🟢 New low" : "🔔 Below threshold";
  const route = `${offer.origin} → ${offer.destination}`;
  const dates = offer.returnDate
    ? `${offer.departDate} → ${offer.returnDate}`
    : offer.departDate;
  const stops = offer.stops === 0 ? "direct" : `${offer.stops} stop(s)`;

  const lines = [
    `<b>${heading}</b> — ${esc(watchLabel)}`,
    `${esc(route)}  ·  ${esc(dates)}  ·  ${stops}`,
    `<b>${offer.price} ${esc(offer.currency)}</b>` +
      (previousBest !== null ? `  (was ${previousBest})` : ""),
  ];
  if (offer.airline) lines.push(`Airline: ${esc(offer.airline)}`);
  if (offer.link) lines.push(`<a href="${esc(offer.link)}">Open in Aviasales</a>`);
  lines.push("\n<i>Cached fare from recent searches — verify before booking.</i>");

  return sendTelegramMessage(lines.join("\n"));
}
