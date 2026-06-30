import { buildApiContainer, createHttpServer } from './container.js';

/**
 * API entrypoint (TASK-018..023). Builds the composition root, starts the framework-free
 * HTTP server and installs graceful-shutdown handlers that drain the DB pool and queue
 * connection. Invalid environment (e.g. non-Testnet) fails fast in `buildApiContainer`.
 */
function main(): void {
  const container = buildApiContainer();
  const server = createHttpServer(container.app);

  server.listen(container.config.api.port, () => {
    container.logger.info('api listening', {
      port: container.config.api.port,
      env: container.config.nodeEnv,
    });
  });

  const shutdown = (signal: string): void => {
    container.logger.info('shutting down', { signal });
    server.close(() => {
      void container.close().finally(() => process.exit(0));
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
