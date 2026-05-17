import pino, { Logger } from "pino";

export function createLogger(verbose?: boolean) {
  return pino({
    level: verbose ? "debug" : "info",
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
      },
    },
  });
}

export function logProgress(iterationIndexFromOne: number, totalItems: number, singularNoun: string, logger: Logger) {
  const modulo = determineLoggingModulo(totalItems);
  if (iterationIndexFromOne % modulo === 0 || iterationIndexFromOne === totalItems) {
    logger.info(
      "progress: processing %s %d of %d (%d\%)",
      singularNoun,
      iterationIndexFromOne,
      totalItems,
      Math.round((iterationIndexFromOne / totalItems) * 100),
    );
  }
}

function determineLoggingModulo(totalItems: number): number {
  let modulo = 10;
  if (totalItems > 1000) {
    modulo = 100;
  } else if (totalItems > 500) {
    modulo = 50;
  } else if (totalItems > 100) {
    modulo = 20;
  }

  return modulo;
}
