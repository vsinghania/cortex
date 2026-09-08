import { JobStatus } from '../types/job.types.js';

export type ClaimQueryParams = {
  worker_id: string;
  lease_ms: number;
  /** Injected clock - never Date.now() inside, so the query is assertable. */
  now: Date;
};

export type BuiltClaimQuery = {
  filter: Record<string, unknown>;
  /** Aggregation pipeline: $cond and $ifNull need one. */
  update: Record<string, unknown>[];
  options: Record<string, unknown>;
};

/**
 * Builds the dequeue query as plain objects so it can be asserted in a unit test
 * with no database, in the style of AgentIdGenerator's injected predicate. The
 * repository does nothing but hand these three objects to findOneAndUpdate.
 */
export class JobClaimQuery {
  private constructor() {}

  static build(params: ClaimQueryParams): BuiltClaimQuery {
    const { now, worker_id } = params;
    const lease_until = new Date(now.getTime() + params.lease_ms);

    return {
      // Two predicates, and that is the whole query. visible_at carries both
      // "when may this run" (queued) and "when does the current claim lapse"
      // (running), so reclaiming a crashed worker's job IS the claim - there is
      // no separate reaper. Terminal jobs hold visible_at null and Mongo's range
      // operators are type-bracketed, so they never match.
      filter: {
        status: { $in: [JobStatus.Queued, JobStatus.Running] },
        visible_at: { $lte: now }
      },

      update: [
        {
          $set: {
            // Distinguishes a crash-reclaim from a fresh dequeue with no second
            // round trip.
            reclaimed_count: {
              $cond: [
                { $eq: ['$status', JobStatus.Running] },
                { $add: ['$reclaimed_count', 1] },
                '$reclaimed_count'
              ]
            },
            // First claim wins, and survives reclaims.
            started_at: { $ifNull: ['$started_at', now] },

            status: JobStatus.Running,
            // At claim, not at failure: a handler that hard-crashes the process
            // never reaches a failure write, so counting here is what makes a
            // poison job self-limiting.
            attempts: { $add: ['$attempts', 1] },

            locked_by: worker_id,
            locked_at: now,
            lease_expires_at: lease_until,
            visible_at: lease_until,

            // Pipeline updates bypass Mongoose's timestamps plugin.
            updated_at: now
          }
        }
      ],

      // Matches the job_claim key order exactly, so no blocking SORT stage.
      options: { sort: { visible_at: 1 }, returnDocument: 'after', lean: true }
    };
  }
}
