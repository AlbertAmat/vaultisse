import {SessionCookie} from "../../src/utils/SessionCookie";

describe("sessionCookieOptions", () => {
    it("uses SameSite=Lax so the OIDC callback redirect can send the new session", () => {
        expect(SessionCookie.sessionCookieOptions()).toMatchObject({
            httpOnly: true,
            sameSite: "lax",
            path: "/",
        });
        expect(SessionCookie.sessionClearCookieOptions()).toMatchObject({
            httpOnly: true,
            sameSite: "lax",
            path: "/",
        });
        expect(SessionCookie.sessionClearCookieOptions().maxAge).toBeUndefined();
    });
});
