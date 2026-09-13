import {sessionClearCookieOptions, sessionCookieOptions} from "../../src/utils/SessionCookie";

describe("sessionCookieOptions", () => {
    it("uses SameSite=Lax so the OIDC callback redirect can send the new session", () => {
        expect(sessionCookieOptions()).toMatchObject({
            httpOnly: true,
            sameSite: "lax",
            path: "/",
        });
        expect(sessionClearCookieOptions()).toMatchObject({
            httpOnly: true,
            sameSite: "lax",
            path: "/",
        });
        expect(sessionClearCookieOptions().maxAge).toBeUndefined();
    });
});
