import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";

const app = createApp();

app.listen(env.PORT, () => {
  logger.info(`Suthrayaa backend listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});
