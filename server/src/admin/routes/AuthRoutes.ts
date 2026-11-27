/**
 * Admin login and session endpoints (mounted at `/api/admin/auth`).
 *
 *  POST /login           email + password -> pending cookie; `{next: "totp" | "enroll"}`
 *  POST /2fa             6-digit code or backup code -> session cookie
 *  POST /enroll/start    first login without two-factor: secret + QR
 *  POST /enroll/confirm  confirm a code -> two-factor on, session cookie, one-time backup codes
 *  GET  /me              the signed-in admin
 *  POST /logout
 *  POST /reauth          password + code again, unlocking dangerous actions for 5 minutes
 *  POST /password        change own password
 */
import {Request, Router} from "express";
import rateLimit from "express-rate-limit";
import {UnauthorizedError} from "../../errors/DomainError";
import {rateLimited} from "../../middlewares/RateLimitHandler";
import {appService} from "../../AppService";
import {ADMIN_COOKIE, ADMIN_PENDING_COOKIE, clearAdminCookies, clearPendingCookie, handle, setAdminCookie, setPendingCookie} from "../http";
import {requireAdmin} from "../middleware";
import {AdminAuditService} from "../services/AdminAuditService";
import {AdminAuthService, SESSION_IDLE_MS} from "../services/AdminAuthService";

/**
 * @param auth Admin auth service.
 * @param audit Admin audit trail.
 * @returns The router.
 */
export function authRoutes(auth: AdminAuthService, audit: AdminAuditService): Router {
    const router = Router();

    // Strict: this is the most valuable login on the installation.
    const loginLimiter = rateLimit({
        windowMs: 5 * 60 * 1000,
        max: 10,
        message: {message: "Too many attempts, please try again later."},
        handler: rateLimited("admin-login"),
    });

    /** Notes a failed admin login in the audit trail and the security events, never failing the request itself. */
    const noteFailure = async (req: Request, what: string, email?: string): Promise<void> => {
        appService.getSecurityEvents().record("admin_login_failed", req, what);
        try {
            await audit.recordAs("auth.login_failed", {id: null, email: email ?? null}, req.ip ?? null, {metadata: {stage: what}});
        } catch (error) {
            console.error("Auditing a failed admin login failed", error);
        }
    };

    const pendingFrom = (req: Request, stage: "totp" | "enroll") => {
        const pending = auth.verifyPendingToken(req.cookies?.[ADMIN_PENDING_COOKIE]);
        if (!pending || pending.stage !== stage) {
            throw new UnauthorizedError("Your login expired. Start again.");
        }
        return pending;
    };

    router.post("/login", loginLimiter, handle(async (req, res) => {
        const email = typeof req.body?.email === "string" ? req.body.email : "";
        try {
            const {result} = await auth.checkPassword(email, req.body?.password);
            setPendingCookie(res, result.pendingToken);
            res.json({next: result.next});
        } catch (error) {
            if (error instanceof UnauthorizedError) {
                await noteFailure(req, "password", email);
            }
            throw error;
        }
    }));

    router.post("/2fa", loginLimiter, handle(async (req, res) => {
        const pending = pendingFrom(req, "totp");
        try {
            const session = await auth.completeSecondFactor(pending.adminId, {code: req.body?.code, backupCode: req.body?.backupCode}, req.headers["user-agent"], req.ip);
            clearPendingCookie(res);
            setAdminCookie(res, session.token, SESSION_IDLE_MS);
            await audit.recordAs("auth.login", {id: session.admin.id, email: session.admin.email}, req.ip ?? null);
            res.json({admin: publicAdmin(session.admin)});
        } catch (error) {
            if (error instanceof UnauthorizedError) {
                await noteFailure(req, "second factor");
            }
            throw error;
        }
    }));

    router.post("/enroll/start", loginLimiter, handle(async (req, res) => {
        const pending = pendingFrom(req, "enroll");
        res.json(await auth.startEnrollment(pending.adminId));
    }));

    router.post("/enroll/confirm", loginLimiter, handle(async (req, res) => {
        const pending = pendingFrom(req, "enroll");
        try {
            const session = await auth.confirmEnrollment(pending.adminId, req.body?.code, req.headers["user-agent"], req.ip);
            clearPendingCookie(res);
            setAdminCookie(res, session.token, SESSION_IDLE_MS);
            await audit.recordAs("auth.two_factor_enabled", {id: session.admin.id, email: session.admin.email}, req.ip ?? null);
            await audit.recordAs("auth.login", {id: session.admin.id, email: session.admin.email}, req.ip ?? null);
            res.json({admin: publicAdmin(session.admin), backupCodes: session.backupCodes});
        } catch (error) {
            if (error instanceof UnauthorizedError) {
                await noteFailure(req, "enrolment code");
            }
            throw error;
        }
    }));

    router.get("/me", requireAdmin(auth), handle(async (req, res) => {
        const admin = req.admin!;
        res.json({
            id: admin.id,
            email: admin.email,
            name: admin.name,
            role: admin.role,
            mustChangePassword: admin.mustChangePassword,
            passwordExpired: admin.passwordExpired ?? false,
            passwordExpiresAt: admin.passwordExpiresAt ?? null,
            passwordDaysLeft: admin.passwordDaysLeft ?? null,
            passwordExpiryWarning: admin.passwordExpiryWarning ?? false,
            reauthUntil: admin.reauthUntil && admin.reauthUntil.getTime() > Date.now() ? admin.reauthUntil : null,
        });
    }));

    router.post("/logout", requireAdmin(auth), handle(async (req, res) => {
        await auth.logout(req.admin!.sessionId);
        await audit.record(req, "auth.logout");
        clearAdminCookies(res);
        res.json({message: "Logged out"});
    }));

    router.post("/reauth", requireAdmin(auth), loginLimiter, handle(async (req, res) => {
        try {
            const until = await auth.reauthenticate(req.admin!, req.body?.password, {code: req.body?.code, backupCode: req.body?.backupCode});
            res.json({reauthUntil: until});
        } catch (error) {
            if (error instanceof UnauthorizedError) {
                await noteFailure(req, "reauthentication", req.admin!.email);
            }
            throw error;
        }
    }));

    router.post("/password", requireAdmin(auth), loginLimiter, handle(async (req, res) => {
        const token = await auth.changePassword(req.admin!, req.body?.currentPassword, req.body?.newPassword);
        setAdminCookie(res, token, SESSION_IDLE_MS);
        await audit.record(req, "auth.password_changed");
        res.json({message: "Password changed"});
    }));

    // Referenced so the cookie name stays exported for the app-level static handler.
    void ADMIN_COOKIE;
    return router;
}

function publicAdmin(admin: {id: number; email: string; name: string; role: string}) {
    return {id: admin.id, email: admin.email, name: admin.name, role: admin.role};
}
