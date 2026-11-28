import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {Logger} from "../../src/utils/Logger";
import {ProcessMonitor} from "../../src/utils/ProcessMonitor";

describe("ProcessMonitor", () => {
    let dir: string;
    let logger: Logger;

    const monitor = () => new ProcessMonitor(logger, {} as never, async () => {});
    const writeState = (extra: object) => fs.writeFileSync(path.join(dir, "runState.json"),
        JSON.stringify({startedAt: "a", lastSeenAt: "b", memoryMb: 90, ...extra}));

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "monitor-"));
        logger = new Logger(dir);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(dir, {recursive: true, force: true});
    });

    it("says nothing on a first start", () => {
        const error = jest.spyOn(logger, "error").mockImplementation(() => {});
        monitor().reportPreviousRun();
        expect(error).not.toHaveBeenCalled();
    });

    it("reports a previous run that was killed", () => {
        const error = jest.spyOn(logger, "error").mockImplementation(() => {});
        writeState({});
        monitor().reportPreviousRun();
        expect(error).toHaveBeenCalledWith(expect.stringContaining("without shutting down"));
    });

    it("reports how a previous run ended", () => {
        const info = jest.spyOn(logger, "info").mockImplementation(() => {});
        writeState({endedBy: "signal SIGTERM"});
        monitor().reportPreviousRun();
        expect(info).toHaveBeenCalledWith(expect.stringContaining("signal SIGTERM"));
    });

    it("writes a crash to the log file and state before exiting", () => {
        const exit = jest.spyOn(process, "exit").mockImplementation((() => {}) as never);
        jest.spyOn(process.stderr, "write").mockImplementation(() => true);
        monitor().crash("uncaught exception", new Error("boom"));
        expect(fs.readFileSync(logger.getLogFilePath(), "utf8")).toContain("boom");
        expect(fs.readFileSync(path.join(dir, "runState.json"), "utf8")).toContain("uncaught exception");
        expect(exit).toHaveBeenCalledWith(1);
    });
});
