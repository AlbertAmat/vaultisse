import {generate} from "otplib";
import {TwoFactorAuth} from "../../src/utils/TwoFactorAuth";

describe("TwoFactorAuth.verifyTotpCode", () => {
    const secret = TwoFactorAuth.generateTotpSecret();

    it.each([
        ["as typed", (code: string) => code],
        ["grouped like authenticator apps show it", (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`],
        ["with spaces around it, as pasting leaves them", (code: string) => ` ${code} `],
    ])("accepts the current code %s", async (_name, format) => {
        const code = await generate({secret});
        expect((await TwoFactorAuth.verifyTotpCode(secret, format(code))).valid).toBe(true);
    });

    it("still refuses something that is not six digits", async () => {
        expect((await TwoFactorAuth.verifyTotpCode(secret, "12345a")).valid).toBe(false);
    });
});
