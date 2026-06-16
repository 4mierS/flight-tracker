import { z } from "zod";

/**
 * Centralised, validated environment. Importing this throws early (at worker
 * boot) if anything required is missing, instead of failing mid-run.
 */
const schema = z.object({
  DATABASE_URL: z.string().url(),

  // Travelpayouts affiliate API token (Profile -> API token).
  TRAVELPAYOUTS_TOKEN: z.string().min(1),
  // Optional cache market override (defaults to ru server-side if unset).
  // For EU routes "uk" or "us" tend to give cleaner EUR/USD caches.
  TRAVELPAYOUTS_MARKET: z.string().optional(),

  // Telegram bot (primary alert channel).
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),

  // node-cron expression. Default: every 4 hours, on the hour.
  CRON_SCHEDULE: z.string().default("0 */4 * * *"),

  // Default currency for new watches / fallback.
  DEFAULT_CURRENCY: z.string().default("EUR"),

  // Polite spacing between provider calls (ms) to stay under rate limits.
  PROVIDER_REQUEST_DELAY_MS: z.coerce.number().int().nonnegative().default(400),
});

export const env = schema.parse(process.env);
export type Env = typeof env;
