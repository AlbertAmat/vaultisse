/**
 * Webhooks (mounted at `/api/admin/webhooks`): where the portal sends its events.
 *
 *  GET    /               every webhook (secrets are never returned) and the list of events
 *  POST   /               `{name, kind: slack|discord|telegram|generic, events, url | token+chatId, secret?}`  [fresh verification]
 *  PUT    /:id            `{name, events, url?|token?+chatId?, secret?}` (omit the target to keep it)         [fresh verification when the target changes]
 *  PATCH  /:id            `{enabled}`
 *  DELETE /:id
 *  POST   /:id/test       sends a test message
 *  GET    /:id/deliveries the last attempts
 *
 * Example:
 *   POST /api/admin/webhooks   (fresh verification)
 *     {"name": "Ops channel", "kind": "slack", "url": "https://hooks.slack.com/services/T0/B0/xxxx", "events": ["incident.opened", "ip.blocked"]}
 *     -> 201 {"item": {"id": 1, "kind": "slack", "targetHint": "hooks.slack.com/…xxxx", "events": [...], "enabled": true}}   (the URL itself is never returned)
 *
 *   POST /api/admin/webhooks/1/test  -> {"ok": true, "error": null}   or   {"ok": false, "error": "The service answered HTTP 403."}
 */
import {NextFunction, Request, Response, Router} from "express";
import {NotFoundError, ValidationError} from "../../errors/DomainError";
import {appService} from "../../AppService";
import {handle, idParam} from "../http";
import {requireFreshAuth, requireSuperadmin} from "../middleware";
import {AdminAuditService} from "../services/AdminAuditService";
import {WEBHOOK_EVENTS, WebhookKind, WebhookTarget} from "../services/WebhookService";

const KINDS: WebhookKind[] = ["slack", "discord", "telegram", "generic"];

function targetOf(body: any): WebhookTarget {
    const str = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined);
    return {url: str(body?.url), token: str(body?.token), chatId: str(body?.chatId), secret: str(body?.secret)};
}

/**
 * @param audit Admin audit trail.
 * @returns The router.
 */
export function webhooksRoutes(audit: AdminAuditService): Router {
    const router = Router();
    const service = () => appService.getWebhooks();

    router.get("/", handle(async (_req, res) => {
        res.json({items: await service().list(), events: WEBHOOK_EVENTS});
    }));

    router.post("/", requireSuperadmin, requireFreshAuth, handle(async (req, res) => {
        const kind = req.body?.kind;
        if (!KINDS.includes(kind)) throw new ValidationError("Choose Slack, Discord, Telegram or a generic URL.");
        const id = await service().create({name: req.body?.name, kind, events: req.body?.events, target: targetOf(req.body)}, req.admin!.id);
        const created = await service().find(id);
        await audit.record(req, "webhook.create", {entityType: "webhook", entityId: id, entityLabel: created?.name, metadata: {kind, events: created?.events}});
        res.status(201).json({item: created});
    }));

    router.put("/:id", requireSuperadmin, (req: Request, res: Response, next: NextFunction) => {
        // Pointing a webhook somewhere else sends data elsewhere: that needs a fresh verification.
        const changesTarget = !!(req.body?.url || req.body?.token || req.body?.chatId);
        return changesTarget ? requireFreshAuth(req, res, next) : next();
    }, handle(async (req, res) => {
        const id = idParam(req);
        const target = req.body?.url || req.body?.token || req.body?.chatId || req.body?.secret ? targetOf(req.body) : undefined;
        if (!(await service().update(id, {name: req.body?.name, events: req.body?.events, target}))) throw new NotFoundError("Webhook not found.");
        const item = await service().find(id);
        await audit.record(req, "webhook.update", {entityType: "webhook", entityId: id, entityLabel: item?.name, metadata: {events: item?.events, targetChanged: !!target}});
        res.json({item});
    }));

    router.patch("/:id", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        if (typeof req.body?.enabled !== "boolean") throw new ValidationError("enabled must be true or false.");
        if (!(await service().setEnabled(id, req.body.enabled))) throw new NotFoundError("Webhook not found.");
        await audit.record(req, req.body.enabled ? "webhook.enable" : "webhook.disable", {entityType: "webhook", entityId: id});
        res.json({item: await service().find(id)});
    }));

    router.delete("/:id", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        const existing = await service().find(id);
        if (!existing || !(await service().remove(id))) throw new NotFoundError("Webhook not found.");
        await audit.record(req, "webhook.delete", {entityType: "webhook", entityId: id, entityLabel: existing.name});
        res.json({message: "Removed."});
    }));

    router.post("/:id/test", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        const result = await service().test(id);
        if (!result) throw new NotFoundError("Webhook not found.");
        await audit.record(req, "webhook.test", {entityType: "webhook", entityId: id, metadata: {ok: result.ok}});
        res.json(result);
    }));

    router.get("/:id/deliveries", handle(async (req, res) => {
        const id = idParam(req);
        if (!(await service().find(id))) throw new NotFoundError("Webhook not found.");
        res.json({items: await service().deliveries(id)});
    }));

    return router;
}
