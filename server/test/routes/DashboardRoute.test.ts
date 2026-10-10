import request from "supertest";
import {setupTestApp} from "../helpers/testApp";
import {createAuthenticatedUser} from "../helpers/auth";

const app = setupTestApp();

describe("GET /dashboard", () => {
    it("requires auth", async () => {
        const {agent: unauth} = await createAuthenticatedUser(app);
        // sanity: an authenticated agent works, then compare against no auth at all.
        const authedRes = await unauth.get("/api/rest/dashboard");
        expect(authedRes.status).toBe(200);

        const noAuthRes = await request(app).get("/api/rest/dashboard");
        expect(noAuthRes.status).toBe(302);
    });

    it("aggregates real counts for a fresh user with one book", async () => {
        const user = await createAuthenticatedUser(app);
        await user.agent.post("/api/rest/book").field("name", "Dashboard Book");

        const res = await user.agent.get("/api/rest/dashboard");
        expect(res.status).toBe(200);
        expect(res.body.totalBooks).toBe(1);
        expect(typeof res.body.totalBooks).toBe("number");
        expect(Array.isArray(res.body.lastBooks)).toBe(true);
        expect(res.body.lastBooks.some((b: any) => b.name === "Dashboard Book")).toBe(true);
    });

    it("reports reading-status shelves and the total-read counter", async () => {
        const user = await createAuthenticatedUser(app);

        const wantToReadRes = await user.agent.post("/api/rest/book").field("name", "Dashboard Want To Read");
        await user.agent.put(`/api/rest/book/${wantToReadRes.body}/reading-status`).send({reading_status: 0});

        const currentlyReadingRes = await user.agent.post("/api/rest/book").field("name", "Dashboard Currently Reading");
        await user.agent.put(`/api/rest/book/${currentlyReadingRes.body}/reading-status`).send({reading_status: 1});

        const readRes = await user.agent.post("/api/rest/book").field("name", "Dashboard Read");
        await user.agent.put(`/api/rest/book/${readRes.body}/reading-status`).send({reading_status: 2});

        const res = await user.agent.get("/api/rest/dashboard");
        expect(res.status).toBe(200);
        expect(res.body.wantToRead.some((b: any) => b.name === "Dashboard Want To Read")).toBe(true);
        expect(res.body.currentlyReading.some((b: any) => b.name === "Dashboard Currently Reading")).toBe(true);
        expect(res.body.totalRead).toBe(1);
        expect(typeof res.body.totalRead).toBe("number");
    });
});
