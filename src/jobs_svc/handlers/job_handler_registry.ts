import type { JobName } from '../types/job.types.js';
import type { JobHandler } from '../types/job_handler.types.js';
import { NotFoundError } from '../../common/errors.js';

export class JobHandlerRegistry {
  private static instance: JobHandlerRegistry | null = null;

  private handlers = new Map<JobName, JobHandler<any>>();

  private constructor() {}

  static getInstance(): JobHandlerRegistry {
    if (JobHandlerRegistry.instance) return JobHandlerRegistry.instance;
    JobHandlerRegistry.instance = new JobHandlerRegistry();
    return JobHandlerRegistry.instance;
  }

  register(handler: JobHandler<any>): void {
    if (this.handlers.has(handler.name)) {
      throw new Error(`Job handler already registered: ${handler.name}`);
    }
    this.handlers.set(handler.name, handler);
  }

  registerMany(handlers: JobHandler<any>[]): void {
    for (const handler of handlers) {
      this.register(handler);
    }
  }

  has(name: JobName): boolean {
    return this.handlers.has(name);
  }

  get(name: JobName): JobHandler<any> | undefined {
    return this.handlers.get(name);
  }

  resolve(name: JobName): JobHandler<any> {
    const handler = this.handlers.get(name);
    if (!handler) throw new NotFoundError(`Unknown job handler: ${name}`);
    return handler;
  }

  /**
   * Not a claim filter - the claim is unfiltered, and a worker releases any job it
   * cannot run. Used for the empty-registry startup check and for observability.
   */
  registeredNames(): JobName[] {
    return Array.from(this.handlers.keys());
  }

  list(): JobHandler<any>[] {
    return Array.from(this.handlers.values());
  }
}
