import {appService} from "../../src/AppService";
import {setupTestApp} from "../helpers/testApp";
import {createAuthenticatedUser, ITestUser} from "../helpers/auth";

const app = setupTestApp();

/** Smallest bytes that pass the PNG signature check. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

let user: ITestUser;
let customerId: number;
let stockCode: string;

/** Turns loans on for a user's vault. */
async function enableLoans(who: ITestUser) {
    const vault = (await who.agent.get("/api/rest/vault")).body[0];
    await who.agent.put(`/api/rest/vault/${vault.id}`).send({name: vault.name, loansEnabled: true}).expect(200);
}

beforeAll(async () => {
    user = await createAuthenticatedUser(app);
    await enableLoans(user);
    customerId = (await user.agent.post("/api/rest/customer").send({name: "Card Holder"})).body.id;
    const bookId = (await user.agent.post("/api/rest/book").field("name", "Card Book")).body;
    const locationId = (await user.agent.post("/api/rest/location").send({name: "Shelf", description: ""})).body.id;
    stockCode = (await user.agent.post(`/api/rest/book/${bookId}/stock`).send({status: 0, location_id: locationId})).body.code;
});

describe("library cards", () => {
    it("stores the two custom fields and the background, keeping the image unless told otherwise", async () => {
        expect((await user.agent.get("/api/rest/customer/card/settings")).body).toMatchObject({field1_label: null, background: null});

        const saved = await user.agent.put("/api/rest/customer/card/settings")
            .field("field1_label", "School:").field("field1_value", "North School")
            .field("field2_label", "Course year:").field("field2_value", "2026")
            .attach("background", PNG, {filename: "bg.png", contentType: "image/png"});
        expect(saved.status).toBe(200);
        expect(saved.body.background).toMatch(/^data:image\/png;base64,/);

        const again = await user.agent.put("/api/rest/customer/card/settings").field("field1_label", "School:");
        expect(again.body).toMatchObject({field1_label: "School:", field2_label: null});
        expect(again.body.background).not.toBeNull();
        expect((await user.agent.put("/api/rest/customer/card/settings").field("remove_background", "true")).body.background).toBeNull();

        await user.agent.put("/api/rest/customer/card/settings").field("field1_label", "x".repeat(31)).expect(400);
        await user.agent.put("/api/rest/customer/card/settings")
            .attach("background", Buffer.from("not an image"), {filename: "bg.png", contentType: "image/png"}).expect(400);
    });

    it("sets the photo and member-since date", async () => {
        const res = await user.agent.put(`/api/rest/customer/${customerId}/card`)
            .field("member_since", "2025-09-01").attach("photo", PNG, {filename: "me.png", contentType: "image/png"});
        expect(res.body).toMatchObject({name: "Card Holder", member_since: "2025-09-01"});
        expect(res.body.uuid).toMatch(/^[0-9a-f-]{36}$/);
        expect(res.body.photo).toMatch(/^data:image\/png/);
        await user.agent.put(`/api/rest/customer/${customerId}/card`).field("member_since", "2026-02-31").expect(400);
    });

    it("refuses and hides photos for a public institution", async () => {
        const url = `/api/rest/customer/${customerId}/card`;
        const upload = () => user.agent.put(url).attach("photo", PNG, {filename: "me.png", contentType: "image/png"});
        const flag = (on: boolean) => appService.getDatabasePool().query("UPDATE users SET is_public_institution = $1 WHERE code = $2", [on, user.userCode]);
        await upload().expect(200);
        expect((await user.agent.get("/api/rest/customer/card/settings")).body.photos_allowed).toBe(true);

        await flag(true);
        try {
            expect((await user.agent.get("/api/rest/customer/card/settings")).body.photos_allowed).toBe(false);
            expect((await user.agent.get(url)).body.photo).toBeNull();
            await upload().expect(403);
            await user.agent.put(url).field("member_since", "2025-01-01").expect(200);
        } finally {
            await flag(false);
        }
    });

    it("searches only the copies that can be lent", async () => {
        const codes = async (query: string) => (await user.agent.get("/api/rest/loans/available").query({query})).body.stocks.map((s: {code: string}) => s.code);
        expect(await codes("card bo")).toEqual([stockCode]);
        expect(await codes(stockCode)).toEqual([stockCode]);
        expect(await codes("%")).toEqual([]);

        const pool = appService.getDatabasePool();
        await pool.query("UPDATE book_stocks SET status = 1 WHERE code = $1", [stockCode]);
        try {
            expect(await codes(stockCode)).toEqual([]);
        } finally {
            await pool.query("UPDATE book_stocks SET status = 0 WHERE code = $1", [stockCode]);
        }
    });

    it("resolves a scanned card and lends only available copies", async () => {
        const {uuid} = (await user.agent.get(`/api/rest/customer/${customerId}/card`)).body;
        const scan = await user.agent.get(`/api/rest/customer/card/scan/${uuid.replace(/-/g, "").toUpperCase()}`);
        expect(scan.body.customer.id).toBe(customerId);
        expect(scan.body.loans).toHaveLength(0);
        await user.agent.get("/api/rest/customer/card/scan/nonsense").expect(404);

        const lend = (code: string) => user.agent.post(`/api/rest/customer/${customerId}/card/loan`).send({code});
        const lent = await lend(stockCode);
        expect(lent.status).toBe(200);
        expect(lent.body.loans.map((l: any) => l.code.trim())).toEqual([stockCode.trim()]);
        expect(lent.body.history).toHaveLength(1);

        await lend(stockCode).expect(409);
        await lend("nope").expect(404);

        await user.agent.delete(`/api/rest/customer/${customerId}/book/${stockCode}`).expect(200);
        const after = (await user.agent.get(`/api/rest/customer/card/scan/${uuid}`)).body;
        expect(after.loans).toHaveLength(0);
        expect(after.history[0].returned_at).not.toBeNull();
    });

    it("never exposes or lends another vault's cards and copies", async () => {
        const intruder = await createAuthenticatedUser(app, "Intruder");
        await enableLoans(intruder);
        const {uuid} = (await user.agent.get(`/api/rest/customer/${customerId}/card`)).body;
        await intruder.agent.get(`/api/rest/customer/card/scan/${uuid}`).expect(404);
        await intruder.agent.get(`/api/rest/customer/${customerId}/card`).expect(404);
        await intruder.agent.put(`/api/rest/customer/${customerId}/card`).field("member_since", "2020-01-01").expect(404);

        const theirs = (await intruder.agent.post("/api/rest/customer").send({name: "Theirs"})).body.id;
        await intruder.agent.post(`/api/rest/customer/${theirs}/card/loan`).send({code: stockCode}).expect(404);
        expect((await appService.getDatabasePool().query("SELECT status FROM book_stocks WHERE code = $1", [stockCode])).rows[0].status).toBe(0);
    });
});
