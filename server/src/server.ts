import "dotenv/config";
import { buildApp } from "./app.js";
import { getEnv } from "./config/env.js";

function isAddrInUse(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "EADDRINUSE"
  );
}

async function main(): Promise<void> {
  const env = getEnv();
  const app = await buildApp();

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`Server running on http://localhost:${env.PORT}`);
  } catch (err) {
    if (isAddrInUse(err)) {
      app.log.fatal(
        `Port ${env.PORT} is already in use. Another backend instance is ` +
          `probably still running — stop it first, then retry.`,
      );
    } else {
      app.log.fatal(err);
    }
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "Shutting down gracefully");
    await app.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
