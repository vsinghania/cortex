import type { JobName, JobPayload } from '../types/job.types.js';
import type { JobHandler } from '../types/job_handler.types.js';
import { BadRequestError, NotFoundError } from '../../common/errors.js';

export class JobHandlerRegistry {
  private static instance: JobHandlerRegistry | null = null;

  private handlers = new Map<JobName, JobHandler<any>>();

  private constructor() {}

  static getInstance(): JobHandlerRegistry {
    if (JobHandlerRegistry.instance) return JobHandlerRegistry.instance;
    JobHandlerRegistry.instance = new JobHandlerRegistry();
    return JobHandlerRegistry.instance;
  }

  registerHandler(handler: JobHandler<any>): void {
    if (this.handlers.has(handler.name)) {
      throw new Error(`Job handler already registered: ${handler.name}`);
    }
    this.handlers.set(handler.name, handler);
  }

  registerHandlers(handlers: JobHandler<any>[]): void {
    for (const handler of handlers) {
      this.registerHandler(handler);
    }
  }

  hasHandler(name: JobName): boolean {
    return this.handlers.has(name);
  }

  findHandler(name: JobName): JobHandler<any> | undefined {
    return this.handlers.get(name);
  }

  requireHandler(name: JobName): JobHandler<any> {
    const handler = this.handlers.get(name);
    if (!handler) throw new NotFoundError(`Unknown job handler: ${name}`);
    return handler;
  }

  validateJobPayload(name: JobName, payload: JobPayload): void {
    const handler = this.findHandler(name);
    if (!handler) {
      throw new BadRequestError(
        `Unknown job name: ${name}. Registered: ${this.listRegisteredJobNames().join(', ') || '(none)'}`
      );
    }
    try {
      handler.parsePayload(payload);
    } catch (err) {
      throw new BadRequestError(`Payload is invalid for job ${name}`, { cause: err });
    }
  }

  /**
   * Not a claim filter - the claim is unfiltered, and a worker releases any job it
   * cannot run. Used for the empty-registry startup check and for observability.
   */
  listRegisteredJobNames(): JobName[] {
    return Array.from(this.handlers.keys());
  }

  listHandlers(): JobHandler<any>[] {
    return Array.from(this.handlers.values());
  }
}
