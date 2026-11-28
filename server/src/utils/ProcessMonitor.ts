/**
 * Makes the server log say why the process stopped.
 *
 *  - Crashes (uncaught exceptions, unhandled rejections) are logged with their stack before exiting.
 *  - Stop signals (`docker stop`, host shutdown, Ctrl-C) are logged and the server shuts down cleanly.
 *  - Lost idle database connections are logged instead of crashing the process.
 *  - Kills that no process can catch (SIGKILL, out of memory, power loss) are reported on the next
 *    start: a small state file next to the log is refreshed while running, and one that was never
 *    marked as ended means the previous run was cut off.
 */
import * as fs from "fs";
import * as path from "path";
import type {Pool} from "pg";
import type {Logger} from "./Logger";

/** Content of the state file. */
interface RunState {
    startedAt: string;
    lastSeenAt: string;
    memoryMb: number;
    /** Why the run ended; absent while running, and forever if the process was killed. */
    endedBy?: string;
}

export class ProcessMonitor {
    /** How often the state file is refreshed. */
    private static readonly HEARTBEAT_MS = 60 * 1000;

    /** Time allowed for a clean shutdown; under the 10s Docker waits before killing the container. */
    private static readonly SHUTDOWN_TIMEOUT_MS = 8 * 1000;

    private readonly statePath: string;
    private readonly startedAt = new Date().toISOString();
    private heartbeat: NodeJS.Timeout | null = null;
    private ending = false;

    /**
     * @param logger Server logger; the state file is kept in the same folder as its log file.
     * @param pool Database pool whose idle-connection errors are logged.
     * @param shutdown Closes the listeners and the pool; called on a stop signal.
     */
    public constructor(
        private readonly logger: Logger,
        private readonly pool: Pool,
        private readonly shutdown: () => Promise<void>,
    ) {
        this.statePath = path.join(path.dirname(logger.getLogFilePath()), "runState.json");
    }

    /** Reports how the previous run ended, then starts watching this one. */
    public install(): void {
        this.reportPreviousRun();
        this.logger.info(`Process starting: version=${process.env.APP_VERSION || "dev"} node=${process.version} pid=${process.pid}`);
        this.saveState();
        this.heartbeat = setInterval(() => this.saveState(), ProcessMonitor.HEARTBEAT_MS);
        this.heartbeat.unref();

        // Without a listener, pg's "error" event (database restarted, connection dropped) ends the process.
        this.pool.on("error", (error) => this.logger.error(`Idle database connection lost: ${error.message}`));

        process.on("uncaughtException", (error) => this.crash("uncaught exception", error));
        process.on("unhandledRejection", (reason) => this.crash("unhandled rejection", reason));
        for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
            process.on(signal, () => void this.stop(signal));
        }
        process.on("exit", (code) => this.recordExit(code));
    }

    /** Warns when the state file shows the previous run crashed or was killed. */
    public reportPreviousRun(): void {
        let previous: RunState;
        try {
            previous = JSON.parse(fs.readFileSync(this.statePath, "utf8"));
        } catch {
            return; // First start, or an unreadable file: nothing to report.
        }
        if (!previous.endedBy) {
            this.logger.error(`The previous run (started ${previous.startedAt}) ended without shutting down: `
                + `killed, out of memory or host power loss. Last alive at ${previous.lastSeenAt}, using ${previous.memoryMb} MB.`);
        } else {
            this.logger.info(`Previous run ended at ${previous.lastSeenAt} by: ${previous.endedBy}`);
        }
    }

    /**
     * Logs a fatal error and exits with code 1, so the container's restart policy applies.
     * @param kind What happened, for the log line.
     * @param error The thrown value or rejection reason.
     */
    public crash(kind: string, error: unknown): void {
        const detail = error instanceof Error ? error.stack ?? error.message : String(error);
        this.logger.errorSync(`FATAL ${kind}, exiting (memory ${ProcessMonitor.memoryMb()} MB): ${detail}`);
        this.markEnded(kind);
        process.exit(1);
    }

    /**
     * Shuts down after a stop signal.
     * @param signal The signal received.
     */
    public async stop(signal: NodeJS.Signals): Promise<void> {
        if (this.ending) {
            return;
        }
        this.logger.errorSync(`Received ${signal} after ${Math.round(process.uptime())}s: something asked the server to stop `
            + `(docker stop/compose down, an image update, Docker or host restart). Shutting down.`);
        // Recorded first: the process may be killed before the shutdown below completes.
        this.markEnded(`signal ${signal}`);
        setTimeout(() => process.exit(0), ProcessMonitor.SHUTDOWN_TIMEOUT_MS).unref();
        try {
            await this.shutdown();
        } catch (error) {
            this.logger.errorSync(`Shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        process.exit(0);
    }

    /**
     * Logs an exit that neither crash() nor stop() announced (a `process.exit()` elsewhere).
     * @param code Exit code.
     */
    public recordExit(code: number): void {
        if (this.ending) {
            return;
        }
        this.logger.errorSync(`Process exiting with code ${code}.`);
        this.markEnded(`exit code ${code}`);
    }

    /**
     * Stops the heartbeat and records why the run ended.
     * @param reason Stored in the state file.
     */
    private markEnded(reason: string): void {
        this.ending = true;
        if (this.heartbeat) {
            clearInterval(this.heartbeat);
        }
        this.saveState(reason);
    }

    /**
     * Writes the state file. A failure is logged and otherwise ignored.
     * @param endedBy Why the run ended; omitted while it is running.
     */
    private saveState(endedBy?: string): void {
        const state: RunState = {
            startedAt: this.startedAt,
            lastSeenAt: new Date().toISOString(),
            memoryMb: ProcessMonitor.memoryMb(),
            endedBy,
        };
        try {
            fs.writeFileSync(this.statePath, JSON.stringify(state));
        } catch (error) {
            this.logger.warn(`Writing ${this.statePath} failed: ${error}`);
        }
    }

    /** @returns Resident memory of this process in MB. */
    private static memoryMb(): number {
        return Math.round(process.memoryUsage().rss / 1024 / 1024);
    }
}
