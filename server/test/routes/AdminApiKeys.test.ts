import "../helpers/adminEnv";
import axios from "axios";
import {appService} from "../../src/AppService";
import {createLoggedInAdmin, setupAdminTestApp} from "../helpers/adminAuth";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

const apps = setupAdminTestApp();

const googleOk = {status: 200, data: {items: [{}]}, headers: {}};
const bigImage = {status: 200, data: Buffer.alloc(20000), headers: {"content-type": "image/jpeg"}};
const placeholder = {status: 200, data: Buffer.alloc(800), headers: {"content-type": "image/gif"}};

beforeEach(() => mockedAxios.get.mockReset());

describe("API keys section", () => {
    it("is its own group, with the testable keys marked", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const groups = (await admin.agent.get("/api/admin/settings")).body.groups;
        const group = groups.find((g: any) => g.label === "API keys");
        expect(group.items.map((i: any) => [i.key, i.testable])).toEqual([["GOOGLE_BOOKS_API_KEY", true], ["LIBRARYTHING_API_KEY", true]]);
    });

    it("tests a Google Books key typed in the form without saving it", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        mockedAxios.get.mockResolvedValueOnce(googleOk);
        const res = await admin.agent.post("/api/admin/settings/test-key").send({key: "GOOGLE_BOOKS_API_KEY", value: "typed-key"});
        expect(res.body).toMatchObject({ok: true});
        expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining("googleapis.com/books"), expect.objectContaining({params: expect.objectContaining({key: "typed-key"})}));
        expect(appService.getGoogleApiKey()).toBeUndefined();
    });

    it("explains why Google refused a key, a used-up quota, and an unreachable service", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const test = () => admin.agent.post("/api/admin/settings/test-key").send({key: "GOOGLE_BOOKS_API_KEY", value: "k"});

        mockedAxios.get.mockResolvedValueOnce({status: 400, data: {error: {message: "API key not valid. Please pass a valid API key."}}, headers: {}});
        expect((await test()).body).toEqual({ok: false, message: "Google rejected the key: API key not valid. Please pass a valid API key."});

        mockedAxios.get.mockResolvedValueOnce({status: 429, data: {error: {message: "Quota exceeded"}}, headers: {}});
        expect((await test()).body.message).toMatch(/valid but its quota is used up/);

        mockedAxios.get.mockRejectedValueOnce(Object.assign(new Error("getaddrinfo ENOTFOUND"), {code: "ENOTFOUND"}));
        const offline = (await test()).body;
        expect(offline.ok).toBe(false);
        expect(offline.message).toMatch(/Couldn't reach the service/);

        mockedAxios.get.mockRejectedValueOnce(Object.assign(new Error("timeout"), {code: "ECONNABORTED"}));
        expect((await test()).body.message).toMatch(/in time/);
    });

    it("tells a real LibraryThing cover from its placeholder", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const test = () => admin.agent.post("/api/admin/settings/test-key").send({key: "LIBRARYTHING_API_KEY", value: "lt"});
        mockedAxios.get.mockResolvedValueOnce(bigImage);
        expect((await test()).body.ok).toBe(true);
        mockedAxios.get.mockResolvedValueOnce(placeholder);
        const fake = (await test()).body;
        expect(fake.ok).toBe(false);
        expect(fake.message).toMatch(/placeholder/);
        mockedAxios.get.mockResolvedValueOnce({status: 403, data: Buffer.alloc(0), headers: {}});
        expect((await test()).body).toMatchObject({ok: false, message: "LibraryThing rejected the key."});
    });

    it("tests the saved key when the field is left empty, and asks for one when there is none", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const test = () => admin.agent.post("/api/admin/settings/test-key").send({key: "GOOGLE_BOOKS_API_KEY"});
        expect((await test()).status).toBe(400);
        expect(mockedAxios.get).not.toHaveBeenCalled();

        await admin.reauth();
        await admin.agent.put("/api/admin/settings").send({changes: {GOOGLE_BOOKS_API_KEY: "saved-key"}});
        mockedAxios.get.mockResolvedValueOnce(googleOk);
        expect((await test()).body.ok).toBe(true);
        expect(mockedAxios.get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({params: expect.objectContaining({key: "saved-key"})}));
        await admin.agent.put("/api/admin/settings").send({changes: {GOOGLE_BOOKS_API_KEY: null}});
    });

    it("only tests keys it knows, only for superadmins, and never puts the key in the audit trail", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        expect((await admin.agent.post("/api/admin/settings/test-key").send({key: "SMTP_PASSWORD", value: "x"})).status).toBe(400);
        const readonly = await createLoggedInAdmin(apps.admin(), "readonly");
        expect((await readonly.agent.post("/api/admin/settings/test-key").send({key: "GOOGLE_BOOKS_API_KEY", value: "x"})).status).toBe(403);

        mockedAxios.get.mockResolvedValueOnce(googleOk);
        await admin.agent.post("/api/admin/settings/test-key").send({key: "GOOGLE_BOOKS_API_KEY", value: "do-not-log-me"});
        const audit = await admin.agent.get("/api/admin/logs/audit").query({action: "settings.test_key"});
        expect(audit.body.items.length).toBeGreaterThan(0);
        expect(JSON.stringify(audit.body)).not.toContain("do-not-log-me");
    });
});
