import * as fs from "fs";
import * as path from "path";
import {setupTestApp} from "../helpers/testApp";
import {createAuthenticatedUser} from "../helpers/auth";

const app = setupTestApp();
const LOG_FILE = path.join(process.env.LOGGER_PATH as string, "bookStorage.log");

/**
 * Reads the log file after giving the logger's async append a moment to land.
 */
async function readLog(): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return fs.readFileSync(LOG_FILE, "utf8");
}

describe("failed requests are written to the server log", () => {
    it("logs a 4xx with method, path, status, user id and the error message, but no query string or body", async () => {
        const user = await createAuthenticatedUser(app);
        const marker = `no-such-vault-${Date.now()}`;

        const res = await user.agent.put("/api/rest/vault/999999999").query({secret: marker}).send({name: "x", password: marker});
        expect(res.status).toBeGreaterThanOrEqual(400);

        const log = await readLog();
        const line = log.split("\n").reverse().find((l) => l.includes("PUT /api/rest/vault/999999999"));
        expect(line).toBeDefined();
        expect(line).toContain("[WARN]");
        expect(line).toContain(`-> ${res.status}`);
        expect(line).toMatch(/user=\d+/);
        expect(log).not.toContain(marker);
    });
});
