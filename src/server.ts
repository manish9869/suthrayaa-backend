import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { warmSettingsCache } from "./modules/settings/settings.service.js";

const app = createApp();

warmSettingsCache().catch((err) => logger.error({ err }, "Failed to warm settings cache at startup"));

app.listen(env.PORT, () => {
  logger.info(`Suthrayaa backend listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});
