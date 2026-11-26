import "../helpers/mailEnv";
import request from "supertest";
import {appService} from "../../src/AppService";
import {MailService} from "../../src/services/MailService";
import {OidcUserService} from "../../src/services/OidcUserService";
import {setupTestApp} from "../helpers/testApp";
import {nextFakeIp, TEST_PASSWORD} from "../helpers/auth";

/** Every message handed to the stubbed SMTP transport. */
const mockOutbox: {to: string; subject: string; text: string}[] = [];

jest.mock("nodemailer", () => ({
    __esModule: true,
    default: {
        createTransport: () => ({
            sendMail: async (mail: any) => {
                mockOutbox.push({to: mail.to.address, subject: mail.subject, text: mail.text});
            },
        }),
    },
}));

const app = setupTestApp();

/** Registers a fresh account and returns its details. */
async function register() {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const user = {userName: `mail_${suffix}`, email: `mail_${suffix}@example.com`, name: "Mail User"};
    const res = await request(app).post("/register").set("X-Forwarded-For", nextFakeIp()).send({...user, password: TEST_PASSWORD});
    expect(res.status).toBe(201);
    expect(res.body.requiresVerification).toBe(true);
    return user;
}

/** Waits for the newest message to an address with a matching subject (notifications are sent in the background). */
async function mailTo(address: string, subject: RegExp) {
    for (let i = 0; i < 100; i++) {
        const found = [...mockOutbox].reverse().find((m) => m.to === address && subject.test(m.subject));
        if (found) {
            return found;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`No "${subject}" mail to ${address}`);
}

const tokenIn = (text: string) => text.match(/#token=([\w-]+)/)![1];

const login = (username: string, password = TEST_PASSWORD, agent: any = request(app)) =>
    agent.post("/login").set("X-Forwarded-For", nextFakeIp()).send({username, password});

const confirm = (token: string) => request(app).post("/verify-email").set("X-Forwarded-For", nextFakeIp()).send({token});

/** Registers, verifies and logs in. */
async function verifiedUser() {
    const user = await register();
    await confirm(tokenIn((await mailTo(user.email, /Verify/)).text)).expect(200);
    const agent = request.agent(app);
    expect((await login(user.userName, TEST_PASSWORD, agent)).status).toBe(200);
    return {...user, agent};
}

describe("email verification", () => {
    it("blocks login until the emailed link is confirmed, and the link works once", async () => {
        const {userName, email} = await register();

        const blocked = await login(userName);
        expect(blocked.status).toBe(403);
        expect(blocked.body.emailNotVerified).toBe(true);
        expect(blocked.headers["set-cookie"]?.join(";") ?? "").not.toMatch(/(^|;)token=[^;]/);
        // A wrong password reveals nothing about the account's state.
        expect((await login(userName, "WrongPassword1!")).status).toBe(401);

        const mail = await mailTo(email, /Verify/);
        expect(mail.text).toContain("http://localhost:5173/verify-email#token=");
        // Opening the link alone must not verify.
        await request(app).get("/verify-email").expect(200);
        expect((await login(userName)).status).toBe(403);

        await confirm(tokenIn(mail.text)).expect(200);
        expect((await login(userName)).status).toBe(200);
        await confirm(tokenIn(mail.text)).expect(400);
    });

    it("rejects an expired link; a resend after the cooldown replaces it", async () => {
        const {userName, email} = await register();
        const first = tokenIn((await mailTo(email, /Verify/)).text);
        const resend = (username: string) => request(app).post("/verify-email/resend").set("X-Forwarded-For", nextFakeIp()).send({username});

        const before = mockOutbox.length;
        const tooSoon = await resend(userName);
        const unknown = await resend("nobody-here");
        expect(tooSoon.body).toEqual(unknown.body);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(mockOutbox.length).toBe(before);

        await appService.getDatabasePool().query(
            "UPDATE user_email_verifications SET sent_at = NOW() - INTERVAL '2 days', expires_at = NOW() - INTERVAL '1 day' WHERE user_id = (SELECT id FROM users WHERE code = $1)", [userName]);
        await confirm(first).expect(400);

        await resend(userName).expect(200);
        for (let i = 0; i < 100 && mockOutbox.length === before; i++) {
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        await confirm(tokenIn((await mailTo(email, /Verify/)).text)).expect(200);
    });

    it("frees the address of a never-verified registration once its link expired", async () => {
        const stale = await register();
        const again = {userName: `${stale.userName}x`, email: stale.email, name: "Real Owner", password: TEST_PASSWORD};
        const attempt = () => request(app).post("/register").set("X-Forwarded-For", nextFakeIp()).send(again);

        expect((await attempt()).status).toBe(400);
        await appService.getDatabasePool().query(
            "UPDATE user_email_verifications SET expires_at = NOW() - INTERVAL '1 day' WHERE user_id = (SELECT id FROM users WHERE code = $1)", [stale.userName]);
        expect((await attempt()).status).toBe(201);
    });

    it("changes the email only after the new address confirms it", async () => {
        const user = await verifiedUser();
        const newEmail = `new_${user.email}`;
        const stored = async () => (await appService.getDatabasePool().query("SELECT email FROM users WHERE code = $1", [user.userName])).rows[0].email;

        const res = await user.agent.put("/api/rest/user").send({name: user.name, email: newEmail, language: "en", region: "US", currentPassword: TEST_PASSWORD});
        expect(res.body.emailVerificationSent).toBe(true);
        expect(await stored()).toBe(user.email);
        await mailTo(user.email, /email change/);

        await confirm(tokenIn((await mailTo(newEmail, /Confirm/)).text)).expect(200);
        expect(await stored()).toBe(newEmail);
    });

    it("discards the registrant's password when SSO claims an unverified account", async () => {
        const {userName, email} = await register();

        await new OidcUserService(appService.getDatabasePool()).findOrCreateOidcUser({
            issuer: "https://idp.test", sub: userName, email, emailVerified: true,
            name: "Owner", preferredUsername: "owner", groups: null,
        });

        expect((await login(userName)).status).toBe(401);
        await confirm(tokenIn((await mailTo(email, /Verify/)).text)).expect(400);
    });
});

describe("notifications", () => {
    it("reports a join request to the vault's admin and the decision to the requester", async () => {
        const admin = await verifiedUser();
        const guest = await verifiedUser();
        const {rows} = await appService.getDatabasePool().query(
            "SELECT v.id, v.invitation_uuid AS uuid FROM vault v JOIN users u ON u.last_used_vault_id = v.id WHERE u.code = $1", [admin.userName]);
        const guestId = (await appService.getDatabasePool().query("SELECT id FROM users WHERE code = $1", [guest.userName])).rows[0].id;

        await guest.agent.post(`/api/rest/vault/join/${rows[0].uuid}`).expect((r) => expect(r.status).toBeLessThan(300));
        await mailTo(admin.email, /request to join/);

        await admin.agent.put(`/api/rest/vault/${rows[0].id}/members/${guestId}`).send({status: 1}).expect((r) => expect(r.status).toBeLessThan(300));
        await mailTo(guest.email, /was approved/);
    });

    it("tells the user their password changed", async () => {
        const user = await verifiedUser();
        await user.agent.post("/api/rest/user/password").send({currentPassword: TEST_PASSWORD, newPassword: "Another1234!"})
            .expect((r) => expect(r.status).toBeLessThan(300));
        await mailTo(user.email, /password was changed/);
    });
});

describe("MailService.readConfig", () => {
    it("is off with no SMTP settings, refuses half a setup, and requires TLS when authenticating", () => {
        expect(MailService.readConfig({})).toBeNull();
        expect(() => MailService.readConfig({SMTP_HOST: "smtp.example.com"})).toThrow(/Incomplete/);
        expect(MailService.readConfig({SMTP_HOST: "h", SMTP_FROM: "a@b.c", FRONT_END_URL: "https://x.test/", SMTP_USER: "u"}))
            .toMatchObject({port: 587, secure: false, requireTls: true, publicUrl: "https://x.test"});
    });
});
