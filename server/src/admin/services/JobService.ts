/**
 * Registry of the background jobs of the admin portal: the hourly clean-ups and reminders, the five-minute health
 * checks, the daily update check and the daily inactive-account cleanup.
 *
 * Every run - on its schedule or started by an admin - goes through {@link JobService.run}, which records when it ran,
 * how long it took and what it did (or why it failed) in `job_runs`, refuses to start a job that is already running
 * and emails the admins when a job fails. So a failing job shows up in the console instead of only in the server log.
 *
 * Does nothing while the portal is off (the jobs then just run on their old timers, unrecorded).
 */
import {Pool} from "pg";
import {ConflictError, NotFoundError} from "../../errors/DomainError";
import {appService} from "../../AppService";
import {Logger} from "../../utils/Logger";

export type JobTrigger = "schedule" | "manual";

export interface JobDef {
    id: string;
    name: string;
    description: string;
    /** Human wording of when it runs, e.g. "Every hour". */
    schedule: string;
    /** Interval between scheduled runs, for the "next run" estimate. */
    everyMs: number;
    /** Changes or deletes data of people (accounts, deletions, old records): running it by hand needs a fresh verification. */
    dangerous?: boolean;
    /** Does the work; returns a short sentence saying what it did. */
    run: () => Promise<string | void>;
}

export interface JobRun {
    id: number;
    jobId: string;
    trigger: JobTrigger;
    status: "ok" | "failed";
    message: string | null;
    startedAt: Date;
    finishedAt: Date;
    durationMs: number;
    runBy: string | null;
}

export interface JobView {
    id: string;
    name: string;
    description: string;
    schedule: string;
    dangerous: boolean;
    running: boolean;
    lastRun: JobRun | null;
    /** Estimate: the last start plus the interval (or soon after start-up when it never ran). */
    nextRunAt: Date | null;
    /** Failed runs among the last ten. */
    recentFailures: number;
}

const RUN_COLUMNS = `r.id, r.job_id AS "jobId", r.trigger, r.status, r.message, r.started_at AS "startedAt", r.finished_at AS "finishedAt",
    (EXTRACT(EPOCH FROM (r.finished_at - r.started_at)) * 1000)::int AS "durationMs", a.email AS "runBy"`;

/** Runs and records the background jobs. */
export class JobService {
    private readonly jobs = new Map<string, JobDef>();
    private readonly running = new Set<string>();
    private readonly bootedAt = new Date();

    /**
     * @param pool Database pool.
     * @param logger Server logger.
     * @param enabled Whether the admin portal is on.
     */
    public constructor(private readonly pool: Pool, private readonly logger: Logger, private readonly enabled: boolean) {
    }

    /** @returns Whether jobs are tracked (the portal is on). */
    public isEnabled(): boolean {
        return this.enabled;
    }

    /** @param job The job to track. */
    public register(job: JobDef): void {
        this.jobs.set(job.id, job);
    }

    /** @param id Job id. @returns Whether it exists. */
    public has(id: string): boolean {
        return this.jobs.has(id);
    }

    /** @param id Job id. @returns Its definition. */
    public definition(id: string): JobDef | undefined {
        return this.jobs.get(id);
    }

    /**
     * Runs a job and records the outcome. Never throws for a failing job (the failure is the recorded result).
     * @param id Job id.
     * @param trigger Why it runs.
     * @param adminId Admin who started it, for a manual run.
     * @returns The recorded run.
     * @throws NotFoundError for an unknown job, ConflictError when it is already running.
     */
    public async run(id: string, trigger: JobTrigger, adminId: number | null = null): Promise<JobRun> {
        const job = this.jobs.get(id);
        if (!job) {
            throw new NotFoundError("Unknown job.");
        }
        if (this.running.has(id)) {
            throw new ConflictError("This job is already running.");
        }
        this.running.add(id);
        const startedAt = new Date();
        let status: "ok" | "failed" = "ok";
        let message: string | null = null;
        try {
            const result = await job.run();
            message = typeof result === "string" ? result : null;
        } catch (error) {
            status = "failed";
            message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Job "${job.name}" failed: ${message}`);
        } finally {
            this.running.delete(id);
        }
        const finishedAt = new Date();
        const saved = await this.record(id, trigger, status, message, startedAt, finishedAt, adminId);
        if (status === "failed") {
            void appService.getNotifier().notify("jobs", {
                title: `A background job failed: ${job.name}`,
                lines: [`"${job.name}" failed (${trigger === "manual" ? "started by an admin" : "scheduled run"}): ${message}`, "See Jobs in the console for the history."],
                dedupeKey: `job:${id}`,
                cooldownMs: 6 * 60 * 60 * 1000,
            });
        }
        return saved;
    }

    /**
     * Runs a job on its schedule: errors never escape, and a job that is still running is skipped quietly.
     * @param id Job id.
     */
    public async runScheduled(id: string): Promise<void> {
        if (!this.enabled || !this.jobs.has(id) || this.running.has(id)) {
            return;
        }
        await this.run(id, "schedule").catch((error) => this.logger.error(`Job ${id} could not be recorded: ${error instanceof Error ? error.message : String(error)}`));
    }

    private async record(jobId: string, trigger: JobTrigger, status: "ok" | "failed", message: string | null, startedAt: Date, finishedAt: Date, adminId: number | null): Promise<JobRun> {
        const result = await this.pool.query(
            `WITH inserted AS (
                INSERT INTO job_runs (job_id, trigger, status, message, started_at, finished_at, run_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *)
             SELECT ${RUN_COLUMNS} FROM inserted r LEFT JOIN admin_users a ON a.id = r.run_by`,
            [jobId, trigger, status, message?.slice(0, 1000) ?? null, startedAt, finishedAt, adminId]);
        return result.rows[0];
    }

    /** @returns Every job with its last run. */
    public async list(): Promise<JobView[]> {
        const last = await this.pool.query(
            `SELECT DISTINCT ON (r.job_id) ${RUN_COLUMNS} FROM job_runs r LEFT JOIN admin_users a ON a.id = r.run_by ORDER BY r.job_id, r.started_at DESC`);
        const failures = await this.pool.query(
            `SELECT job_id, COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
               FROM (SELECT job_id, status, ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY started_at DESC) AS n FROM job_runs) t
              WHERE n <= 10 GROUP BY job_id`);
        const lastBy = new Map<string, JobRun>(last.rows.map((row: JobRun) => [row.jobId, row]));
        const failedBy = new Map<string, number>(failures.rows.map((row: {job_id: string; failed: number}) => [row.job_id, row.failed]));
        // Most frequent first.
        return [...this.jobs.values()].sort((a, b) => a.everyMs - b.everyMs).map((job) => {
            const lastRun = lastBy.get(job.id) ?? null;
            return {
                id: job.id, name: job.name, description: job.description, schedule: job.schedule, dangerous: job.dangerous === true,
                running: this.running.has(job.id), lastRun,
                nextRunAt: new Date((lastRun ? new Date(lastRun.startedAt).getTime() : this.bootedAt.getTime() + 60 * 1000) + (lastRun ? job.everyMs : 0)),
                recentFailures: failedBy.get(job.id) ?? 0,
            };
        });
    }

    /** @param id Job id. @returns Its last 30 runs, newest first. */
    public async history(id: string): Promise<JobRun[]> {
        const result = await this.pool.query(
            `SELECT ${RUN_COLUMNS} FROM job_runs r LEFT JOIN admin_users a ON a.id = r.run_by WHERE r.job_id = $1 ORDER BY r.started_at DESC LIMIT 30`, [id]);
        return result.rows;
    }

    /** @returns How many jobs failed on their last run. */
    public async failingCount(): Promise<number> {
        const result = await this.pool.query(
            `SELECT COUNT(*)::int AS n FROM (SELECT DISTINCT ON (job_id) status FROM job_runs ORDER BY job_id, started_at DESC) t WHERE status = 'failed'`);
        return result.rows[0].n;
    }

    /** Deletes the run history older than `before`. @param before Cut-off. @returns Rows removed. */
    public async purge(before: Date): Promise<number> {
        const result = await this.pool.query("DELETE FROM job_runs WHERE started_at < $1", [before]);
        return result.rowCount ?? 0;
    }
}
