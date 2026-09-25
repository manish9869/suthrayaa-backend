import app from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";

app.listen(env.PORT, () => {
  logger.info(`Suthrayaa backend listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});
