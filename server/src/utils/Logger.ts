/**
 * Minimal file-based logger: appends timestamped, leveled lines to a single
 * `bookStorage.log` file inside `logDir`. Used for server-side diagnostics
 * (see `LOGGER_PATH` env var in AppService) - not for HTTP access logs.
 *
 * @example
 * const logger = new Logger("/var/log/vaultisse");
 * logger.info("Server running on port 3000;");
 * // -> appends "[2026-08-29T12:00:00.000Z] [INFO]: Server running on port 3000;\n"
 */
import * as fs from "fs";
import * as path from "path";

export class Logger {
    /** Absolute, resolved path to the log directory. */
    private readonly logDir: string;

    /** Absolute path to the log file (`<logDir>/bookStorage.log`). */
    private readonly logFilePath: string;

    /** @param logDir Directory to write `bookStorage.log` into; created if missing. */
    public constructor(logDir: string) {
        this.logDir = path.resolve(logDir);
        this.ensureLogDirectoryExists();
        this.logFilePath = path.join(this.logDir, `bookStorage.log`);
    }

    // Ensure the log directory exists
    private ensureLogDirectoryExists(): void {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    // Write a log entry with a timestamp
    private writeLog(level: string, message: string): void {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] [${level.toUpperCase()}]: ${message}\n`;

        (level === "error" ? process.stderr : process.stdout).write(logEntry);

        fs.appendFile(this.logFilePath, logEntry, (err) => {
            if (err) {
                console.error("Failed to write log:", err);
            }
        });
    }

    /** Log an informational message, e.g. `logger.info("Server running on port 3000;")`. */
    info(message: string): void {
        this.writeLog("info", message);
    }

    /** Log a warning message. */
    warn(message: string): void {
        this.writeLog("warn", message);
    }

    /** Log an error message, typically `err.toString()` from a caught exception. */
    error(message: string): void {
        this.writeLog("error", message);
    }

    /**
     * Log a verbose diagnostic message - request traces, raw SQL text,
     * record names/ids - that may include personal data (borrower/author/
     * customer names, usernames) and should never ship to production logs
     * by default. Only written when `DEBUG_LOGGING=true`; a silent no-op
     * otherwise, so call sites don't need to guard themselves.
     */
    debug(message: string): void {
        if (process.env.DEBUG_LOGGING !== "true") {
            return;
        }
        this.writeLog("debug", message);
    }
}
