import { logger } from '../../common/logger.js'
import { performance } from "node:perf_hooks";

export type ExecTimeLoggerOptions = {
  threshold_in_ms: number;
  level: string;
  only_error: boolean;
}

export function logExecTime(opts?: Partial<ExecTimeLoggerOptions>) {

  opts = {
    threshold_in_ms: Number.POSITIVE_INFINITY,
    only_error: false,
    ...opts
  };

  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      const start = performance.now();
      const className =
        this?.constructor?.name ??
        target?.constructor?.name ??
        "UnknownClass";
      try {
        const result = await originalMethod.apply(this, args);

        const durationMs = performance.now() - start;

        if (!opts?.only_error && (opts.threshold_in_ms! < durationMs)) {
          logger.info(
            {
              class: className,
              method: propertyKey,
              duration_ms: durationMs.toFixed(1)
            },
            "method executed"
          );
        }
        return result;
      } catch (err) {
        const durationMs = performance.now() - start;
        logger.error(
          {
            method: propertyKey,
            duration_ms: durationMs.toFixed(1),
            err
          },
          "method failed"
        );
        throw err;
      }
    };
  }
}

export function logExecutionTime(
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
): PropertyDescriptor {
  const originalMethod = descriptor.value;

  descriptor.value = async function (...args: any[]) {
    const start = performance.now();
    const className =
      this?.constructor?.name ??
      target?.constructor?.name ??
      "UnknownClass";
    try {
      const result = await originalMethod.apply(this, args);

      const durationMs = performance.now() - start;
      logger.info(
        {
          class: className,
          method: propertyKey,
          duration_ms: durationMs.toFixed(1)
        },
        "method executed"
      );

      return result;
    } catch (err) {
      const durationMs = performance.now() - start;
      logger.error(
        {
          method: propertyKey,
          duration_ms: durationMs.toFixed(1),
          err
        },
        "method failed"
      );
      throw err;
    }
  };

  return descriptor;
}
