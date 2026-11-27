/**
 * Compliance (mounted at `/api/admin/compliance`): ISO/IEC 27001 controls measured against the installation,
 * registers (policies, suppliers, risks, assets), the incident register and the review of admin access.
 *
 *  GET    /                      every control with its live result and what was recorded, the score and what needs attention
 *  PUT    /controls/:id          `{status, owner, justification, evidenceUrl, nextReviewAt, reviewed}`
 *  GET    /export.csv            the statement of applicability (every control, whether it applies, how it stands)
 *  GET    /register?kind=        POST /register     PUT /register/:id     DELETE /register/:id
 *  GET    /incidents             POST /incidents    PUT /incidents/:id    (incidents are closed, never deleted)
 *  GET    /access                admins with the date of their last access review
 *  POST   /access                `{ids?}` confirm that the admins (all, by default) still need their access
 *
 * Example:
 *   PUT /api/admin/compliance/controls/A.8.13
 *     {"status": "implemented", "owner": "Operations", "justification": "Nightly pg_dump copied off-site", "evidenceUrl": "https://…", "nextReviewAt": "2027-01-15", "reviewed": true}
 *     -> {"message": "Saved."}      (status "not_applicable" needs a justification; a measured control cannot be declared green)
 */
import {Router} from "express";
import {Pool} from "pg";
import {NotFoundError, ValidationError} from "../../errors/DomainError";
import {appService} from "../../AppService";
import {handle, idParam, text} from "../http";
import {requireSuperadmin} from "../middleware";
import {ComplianceRepository, ControlStatus, IncidentInput, IncidentStatus, RegisterInput, RegisterKind, Severity} from "../repositories/ComplianceRepository";
import {AdminAuditService} from "../services/AdminAuditService";
import {controlIds} from "../services/complianceCatalog";
import {ComplianceService} from "../services/ComplianceService";
import {csvCell} from "./TermsRoutes";

const STATUSES: ControlStatus[] = ["implemented", "partial", "planned", "not_applicable"];
const KINDS: RegisterKind[] = ["policy", "supplier", "risk", "asset"];
const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];
const INCIDENT_STATUSES: IncidentStatus[] = ["open", "contained", "resolved", "closed"];

function optionalText(value: unknown, label: string, max: number): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || value.trim().length > max) {
        throw new ValidationError(`${label} must be text of up to ${max} characters.`);
    }
    return value.trim();
}

function optionalUrl(value: unknown, label: string): string | null {
    const url = optionalText(value, label, 500);
    if (url && !/^https?:\/\//i.test(url)) {
        throw new ValidationError(`${label} must start with http:// or https://.`);
    }
    return url;
}

function optionalDate(value: unknown, label: string): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(value).getTime())) {
        throw new ValidationError(`${label} must be a date (YYYY-MM-DD).`);
    }
    return value;
}

function optionalTimestamp(value: unknown, label: string): Date | null {
    if (value === undefined || value === null || value === "") return null;
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new ValidationError(`${label} isn't a valid date.`);
    return date;
}

function pick<T extends string>(value: unknown, allowed: T[], label: string): T {
    if (typeof value !== "string" || !allowed.includes(value as T)) {
        throw new ValidationError(`${label} must be one of: ${allowed.join(", ")}.`);
    }
    return value as T;
}

function parseRegister(body: any, kind: RegisterKind): RegisterInput {
    const title = optionalText(body?.title, "The title", 200);
    if (!title) throw new ValidationError("Give it a title.");
    const rating = body?.rating === undefined || body?.rating === null || body?.rating === "" ? null : pick(body.rating, ["low", "medium", "high"] as const, "The rating");
    return {
        kind, title, owner: optionalText(body?.owner, "The owner", 100),
        status: body?.status === undefined ? "active" : pick(body.status, ["draft", "active", "retired"] as const, "The status"),
        rating, version: optionalText(body?.version, "The version", 20), details: optionalText(body?.details, "The details", 4000),
        referenceUrl: optionalUrl(body?.referenceUrl, "The link"), approvedAt: optionalDate(body?.approvedAt, "The approval date"),
        nextReviewAt: optionalDate(body?.nextReviewAt, "The next review"),
    };
}

function parseIncident(body: any): IncidentInput {
    const title = optionalText(body?.title, "The title", 200);
    if (!title) throw new ValidationError("Give the incident a title.");
    const status = pick(body?.status ?? "open", INCIDENT_STATUSES, "The status");
    const detectedAt = optionalTimestamp(body?.detectedAt, "The detection date") ?? new Date();
    let resolvedAt = optionalTimestamp(body?.resolvedAt, "The resolution date");
    if ((status === "resolved" || status === "closed") && !resolvedAt) {
        resolvedAt = new Date();
    }
    if (resolvedAt && resolvedAt < detectedAt) {
        throw new ValidationError("It can't be resolved before it was detected.");
    }
    return {
        title, severity: pick(body?.severity, SEVERITIES, "The severity"), status, detectedAt, resolvedAt,
        description: optionalText(body?.description, "The description", 8000), actions: optionalText(body?.actions, "The actions", 8000),
        lessons: optionalText(body?.lessons, "The lessons", 8000), personalData: body?.personalData === true,
        authorityNotifiedAt: optionalTimestamp(body?.authorityNotifiedAt, "The date the authority was told"),
        usersNotifiedAt: optionalTimestamp(body?.usersNotifiedAt, "The date the users were told"),
    };
}

/**
 * @param pool Database pool.
 * @param audit Admin audit trail.
 * @returns The router.
 */
export function complianceRoutes(pool: Pool, audit: AdminAuditService): Router {
    const router = Router();
    const repo = new ComplianceRepository(pool);
    const service = new ComplianceService(pool);

    router.get("/", handle(async (_req, res) => {
        res.json(await service.overview());
    }));

    router.put("/controls/:id", requireSuperadmin, handle(async (req, res) => {
        const id = String(req.params.id);
        if (!controlIds().includes(id)) {
            throw new NotFoundError("Unknown control.");
        }
        const status = req.body?.status === undefined || req.body?.status === null || req.body?.status === "" ? null : pick(req.body.status, STATUSES, "The status");
        const justification = optionalText(req.body?.justification, "The justification", 4000);
        if (status === "not_applicable" && !justification) {
            throw new ValidationError("A control that doesn't apply needs a justification (an auditor will ask for it).");
        }
        await repo.saveControl(id, {
            status, owner: optionalText(req.body?.owner, "The owner", 100), justification,
            evidenceUrl: optionalUrl(req.body?.evidenceUrl, "The evidence link"), nextReviewAt: optionalDate(req.body?.nextReviewAt, "The next review"),
            reviewed: req.body?.reviewed === true,
        }, req.admin!.id);
        await audit.record(req, "compliance.control", {entityType: "compliance", entityLabel: id, metadata: {status, reviewed: req.body?.reviewed === true}});
        res.json({message: "Saved."});
    }));

    router.get("/export.csv", handle(async (_req, res) => {
        const overview = await service.overview();
        const outcome: Record<string, string> = {compliant: "Implemented", partial: "Partly implemented", gap: "Not implemented", planned: "Planned", not_assessed: "Not assessed", not_applicable: "Not applicable"};
        const header = ["Control", "Title", "Applies", "Status", "Measured by the portal", "Owner", "Justification", "Evidence", "Last reviewed", "Next review", "GDPR", "SOC 2"];
        const lines = [header.map(csvCell).join(",")];
        for (const c of overview.controls) {
            lines.push([
                c.id, c.title, c.outcome === "not_applicable" ? "No" : "Yes", outcome[c.outcome], c.measured?.detail ?? "",
                c.record?.owner, c.record?.justification, c.record?.evidenceUrl, c.record?.reviewedAt, c.record?.nextReviewAt, c.refs.gdpr, c.refs.soc2,
            ].map(csvCell).join(","));
        }
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="statement-of-applicability-${new Date().toISOString().slice(0, 10)}.csv"`);
        res.send(`﻿${lines.join("\r\n")}\r\n`);
    }));

    router.get("/register", handle(async (req, res) => {
        const kind = text(req.query.kind);
        res.json({items: await repo.listRegister(kind ? pick(kind, KINDS, "The kind") : undefined)});
    }));

    router.post("/register", requireSuperadmin, handle(async (req, res) => {
        const input = parseRegister(req.body, pick(req.body?.kind, KINDS, "The kind"));
        const id = await repo.createRegister(input, req.admin!.id);
        await audit.record(req, "compliance.register_create", {entityType: input.kind, entityId: id, entityLabel: input.title});
        res.status(201).json({item: await repo.findRegister(id)});
    }));

    router.put("/register/:id", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        const existing = await repo.findRegister(id);
        if (!existing) throw new NotFoundError("Entry not found.");
        const input = parseRegister(req.body, existing.kind);
        await repo.updateRegister(id, input);
        await audit.record(req, "compliance.register_update", {entityType: existing.kind, entityId: id, entityLabel: input.title});
        res.json({item: await repo.findRegister(id)});
    }));

    router.delete("/register/:id", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        const existing = await repo.findRegister(id);
        if (!existing) throw new NotFoundError("Entry not found.");
        await repo.removeRegister(id);
        await audit.record(req, "compliance.register_delete", {entityType: existing.kind, entityId: id, entityLabel: existing.title});
        res.json({message: "Removed."});
    }));

    router.get("/incidents", handle(async (_req, res) => {
        res.json({items: await repo.listIncidents()});
    }));

    router.post("/incidents", requireSuperadmin, handle(async (req, res) => {
        const input = parseIncident(req.body);
        const id = await repo.createIncident(input, req.admin!.id);
        await audit.record(req, "compliance.incident_create", {entityType: "incident", entityId: id, entityLabel: input.title, metadata: {severity: input.severity, personalData: input.personalData}});
        void appService.getWebhooks().emit("incident.opened", {title: `Security incident (${input.severity}): ${input.title}`, lines: [input.personalData ? "Personal data is involved: the authority must be told within 72 hours." : "No personal data involved.", `Recorded by ${req.admin!.email}.`]});
        res.status(201).json({item: await repo.findIncident(id)});
    }));

    router.put("/incidents/:id", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        if (!(await repo.findIncident(id))) throw new NotFoundError("Incident not found.");
        const input = parseIncident(req.body);
        await repo.updateIncident(id, input);
        await audit.record(req, "compliance.incident_update", {entityType: "incident", entityId: id, entityLabel: input.title, metadata: {status: input.status}});
        res.json({item: await repo.findIncident(id)});
    }));

    router.get("/access", handle(async (_req, res) => {
        res.json({items: await repo.accessReviews()});
    }));

    router.post("/access", requireSuperadmin, handle(async (req, res) => {
        const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : null;
        if (ids && ids.some((id: number) => !Number.isInteger(id))) {
            throw new ValidationError("Invalid admin id.");
        }
        const confirmed = await repo.confirmAccess(ids, req.admin!.id);
        await audit.record(req, "compliance.access_review", {entityType: "admin", metadata: {confirmed, ids}});
        res.json({confirmed});
    }));

    return router;
}
