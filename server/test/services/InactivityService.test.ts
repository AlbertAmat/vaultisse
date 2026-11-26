import "../helpers/mailEnv";
import {appService} from "../../src/AppService";
import {InactivityService} from "../../src/services/InactivityService";
import {setupTestApp} from "../helpers/testApp";

/** Addresses the stubbed SMTP transport accepted. */
const mockSent: string[] = [];
let mockSmtpDown = false;

jest.mock("nodemailer", () => ({
    __esModule: true,
    default: {
        createTransport: () => ({
            sendMail: async (mail: any) => {
                if (mockSmtpDown) {
                    throw new Error("down");
                }
                mockSent.push(mail.to.address);
            },
        }),
    },
}));

setupTestApp();

const sql = (text: string, values: unknown[] = []) => appService.getDatabasePool().query(text, values);
const service = (noticeDays: number) => new InactivityService(appService.getDatabasePool(), {inactivityDays: 100, noticeDays});

let counter = 0;

/** Inserts an account last active `idleDays` ago, alone in its own vault. */
async function account(idleDays: number) {
    const code = `idle_${Date.now()}_${counter++}`;
    const {rows} = await sql(
        `INSERT INTO users (name, code, email, password, disabled, created_date)
         VALUES ('Idle', $1, $2, 'x', FALSE, NOW() - make_interval(days => $3)) RETURNING id`,
        [code, `${code}@example.com`, idleDays]);
    const id: number = rows[0].id;
    const vaultId: number = (await sql("INSERT INTO vault (name) VALUES ($1) RETURNING id", [code])).rows[0].id;
    await sql("INSERT INTO vault_users (vault_id, user_id, role, status) VALUES ($1, $2, 1, 1)", [vaultId, id]);
    return {id, vaultId, email: `${code}@example.com`};
}

const exists = async (table: "users" | "vault", id: number) => (await sql(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).rowCount === 1;

/** Ages the warning, and the account with it, as if `days` had passed. */
const passDays = (id: number, days: number) => sql(
    `UPDATE users SET deletion_warned_at = deletion_warned_at - make_interval(days => $2),
                      created_date = created_date - make_interval(days => $2) WHERE id = $1`, [id, days]);

beforeEach(() => {
    mockSmtpDown = false;
});

describe("InactivityService.run", () => {
    it("warns first, and deletes only once the notice period has passed", async () => {
        const idle = await account(500);
        const active = await account(10);

        await service(10).run();
        expect(mockSent).toContain(idle.email);
        expect(mockSent).not.toContain(active.email);
        // Long idle already, but it still gets the full notice.
        await service(10).run();
        expect(await exists("users", idle.id)).toBe(true);
        expect(mockSent.filter((to) => to === idle.email)).toHaveLength(1);

        await passDays(idle.id, 11);
        await service(10).run();
        expect(await exists("users", idle.id)).toBe(false);
        expect(await exists("vault", idle.vaultId)).toBe(false);
        expect(await exists("users", active.id)).toBe(true);
    });

    it("cancels the warning when the account is used again", async () => {
        const user = await account(95);
        await service(10).run();
        await passDays(user.id, 11);
        await sql("UPDATE users SET last_login_date = NOW() WHERE id = $1", [user.id]);

        await service(10).run();
        expect(await exists("users", user.id)).toBe(true);
    });

    it("never deletes when the warning couldn't be sent", async () => {
        const user = await account(500);
        mockSmtpDown = true;
        await service(10).run();
        await service(10).run();
        expect(await exists("users", user.id)).toBe(true);
        expect((await sql("SELECT deletion_warned_at AS w FROM users WHERE id = $1", [user.id])).rows[0].w).toBeNull();
    });

    it("deletes without warning when there is no notice period, sparing shared and unusable accounts", async () => {
        const gone = await account(101);
        const soleAdmin = await account(500);
        const disabled = await account(500);
        const reader = await account(500);
        await sql("UPDATE users SET disabled = TRUE WHERE id = $1", [disabled.id]);
        await sql("UPDATE users SET last_activity_date = NOW() WHERE id = $1", [reader.id]);
        const member = await account(1);
        await sql("INSERT INTO vault_users (vault_id, user_id, role, status) VALUES ($1, $2, 0, 1)", [soleAdmin.vaultId, member.id]);

        await service(0).run();
        expect(await exists("users", gone.id)).toBe(false);
        for (const kept of [soleAdmin, disabled, reader, member]) {
            expect(await exists("users", kept.id)).toBe(true);
        }
    });
});

describe("InactivityService.readConfig", () => {
    const read = (days?: string, notice?: string, mail = true) =>
        InactivityService.readConfig({ACCOUNT_INACTIVITY_DAYS: days, ACCOUNT_DELETION_NOTICE_DAYS: notice}, mail);

    it("is off by default and refuses unsafe settings", () => {
        expect(read()).toBeNull();
        expect(read("", "10")).toBeNull();
        expect(read("365")).toEqual({inactivityDays: 365, noticeDays: 0});
        expect(read("365", "30")).toEqual({inactivityDays: 365, noticeDays: 30});
        expect(() => read("1y")).toThrow();
        expect(() => read("30", "30")).toThrow();
        expect(() => read("365", "30", false)).toThrow(/mail/);
    });
});
