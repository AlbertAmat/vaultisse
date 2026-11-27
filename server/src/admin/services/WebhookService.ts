/**
 * Sends events of the admin portal to Slack, Discord, Telegram or any URL.
 *
 * A webhook subscribes to some events; when one happens (an account registers, an incident is recorded, an
 * address is blocked, an alert is raised) every enabled subscriber gets a short message. Delivery is best
 * effort: one attempt with a short timeout, the result kept in `webhook_deliveries`, and a failing webhook never
 * affects what raised the event.
 *
 * The secret part of a target (webhook URL, bot token, signing secret) is stored encrypted and never returned.
 * Because a URL an admin types makes the server call out, targets are restricted: Slack, Discord and Telegram
 * only reach their own hosts, and a generic URL must be HTTPS and resolve to a public address (set
 * ADMIN_WEBHOOKS_ALLOW_PRIVATE=true to reach an internal service on purpose).
 */
import crypto from "crypto";
import dns from "dns/promises";
import axios from "axios";
import {Pool} from "pg";
import {ValidationError} from "../../errors/DomainError";
import {appService} from "../../AppService";
import {Logger} from "../../utils/Logger";
import {isPublicAddress} from "./AutoBlocker";
import {SettingsCrypto} from "./SettingsCrypto";

export type WebhookKind = "slack" | "discord" | "telegram" | "generic";

export const WEBHOOK_EVENTS = [
    {id: "account.created", label: "A new account registered"},
    {id: "account.pending", label: "An account is waiting for approval"},
    {id: "incident.opened", label: "A security incident was recorded"},
    {id: "ip.blocked", label: "An address was blocked"},
    {id: "security.alert", label: "Security alert (many failed sign-ins, ...)"},
    {id: "anomaly.detected", label: "Anomaly (sign-ins from a new country, burst of sign-ups)"},
    {id: "admin.login_new_country", label: "An admin signed in from a new country"},
    {id: "data_request.created", label: "A data request (access or erasure) was logged"},
    {id: "data_request.due", label: "A data request is close to its deadline or overdue"},
    {id: "deletion.done", label: "An account or vault was deleted"},
    {id: "system.alert", label: "System alert (database, email failures, new version, restart)"},
] as const;

export type WebhookEvent = typeof WEBHOOK_EVENTS[number]["id"];
const EVENT_IDS: string[] = WEBHOOK_EVENTS.map((e) => e.id);

export interface WebhookMessage {
    title: string;
    lines: string[];
    /** Don't send the same message again within `cooldownMs`. */
    dedupeKey?: string;
    cooldownMs?: number;
}

/** What is kept (encrypted) about where to send. */
export interface WebhookTarget {
    url?: string;
    token?: string;
    chatId?: string;
    secret?: string;
}

export interface WebhookView {
    id: number;
    name: string;
    kind: WebhookKind;
    /** A hint of where it goes, never the secret itself. */
    targetHint: string;
    events: string[];
    enabled: boolean;
    lastStatus: "sent" | "failed" | null;
    lastError: string | null;
    lastAt: Date | null;
}

export interface WebhookDelivery {
    id: number;
    event: string;
    status: "sent" | "failed";
    httpStatus: number | null;
    error: string | null;
    createdDate: Date;
}

export interface WebhookInput {
    name: string;
    kind: WebhookKind;
    events: string[];
    target: WebhookTarget;
}

const TIMEOUT_MS = 8000;
const MAX_TEXT = 1800;

function hostIs(url: URL, ...hosts: string[]): boolean {
    return hosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
}

/**
 * Checks the shape of a target and that it can only reach the place it is meant for.
 * @param kind Kind of webhook.
 * @param target What the admin typed.
 * @throws ValidationError when it isn't acceptable.
 *
 * @example
 *   validateTarget("slack", {url: "https://hooks.slack.com/services/T0/B0/xxxx"})   // ok
 *   validateTarget("slack", {url: "https://evil.example.com/services/T0/B0/xxxx"})   // throws: not a Slack webhook URL
 *   validateTarget("telegram", {token: "123456:ABC...", chatId: "-1001234567"})      // ok (negative id = group)
 *   validateTarget("generic", {url: "http://example.com/x"})                         // throws: must be https (unless ALLOW_HTTP=true)
 */
export function validateTarget(kind: WebhookKind, target: WebhookTarget): void {
    if (kind === "telegram") {
        if (!/^\d{5,}:[\w-]{20,}$/.test(target.token ?? "")) {
            throw new ValidationError("The bot token looks like 123456:ABC-DEF... (from @BotFather).");
        }
        if (!/^(-?\d{3,}|@\w{4,})$/.test(target.chatId ?? "")) {
            throw new ValidationError("The chat id is a number (negative for a group) or @channelname.");
        }
        return;
    }
    let url: URL;
    try {
        url = new URL(target.url ?? "");
    } catch {
        throw new ValidationError("That isn't a valid URL.");
    }
    if (kind === "slack" && !(url.protocol === "https:" && url.hostname === "hooks.slack.com" && url.pathname.startsWith("/services/"))) {
        throw new ValidationError("A Slack webhook URL looks like https://hooks.slack.com/services/T000/B000/XXXX.");
    }
    if (kind === "discord" && !(url.protocol === "https:" && hostIs(url, "discord.com", "discordapp.com") && url.pathname.startsWith("/api/webhooks/"))) {
        throw new ValidationError("A Discord webhook URL looks like https://discord.com/api/webhooks/123/abc.");
    }
    if (kind === "generic") {
        const allowHttp = process.env.ALLOW_HTTP === "true";
        if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
            throw new ValidationError("The URL must start with https://.");
        }
        if (url.username || url.password) {
            throw new ValidationError("Don't put credentials in the URL.");
        }
    }
}

/** @throws Error when the host of a generic URL resolves to a private address (unless allowed). */
async function assertPublicHost(url: URL): Promise<void> {
    if (process.env.ADMIN_WEBHOOKS_ALLOW_PRIVATE === "true") {
        return;
    }
    const addresses = await dns.lookup(url.hostname, {all: true});
    if (addresses.length === 0 || addresses.some((a) => !isPublicAddress(a.address))) {
        throw new Error("The address of that host is private or local, which is not allowed.");
    }
}

/** Sends the portal's events to webhooks. */
export class WebhookService {
    private readonly crypto: SettingsCrypto;
    private readonly cooldown = new Map<string, number>();

    /**
     * @param pool Database pool.
     * @param logger Server logger.
     * @param enabled Whether the admin portal is on.
     * @param secret Key material for encrypting targets (the settings encryption key).
     */
    public constructor(private readonly pool: Pool, private readonly logger: Logger, private readonly enabled: boolean, secret: string) {
        this.crypto = new SettingsCrypto(secret);
    }

    private hint(kind: WebhookKind, target: WebhookTarget): string {
        if (kind === "telegram") return `${target.chatId} · bot …${(target.token ?? "").slice(-4)}`;
        try {
            const url = new URL(target.url ?? "");
            return `${url.hostname}/…${(target.url ?? "").slice(-4)}`;
        } catch {
            return "";
        }
    }

    private view(row: any): WebhookView {
        const target: WebhookTarget = JSON.parse(this.crypto.decrypt(row.target));
        return {
            id: row.id, name: row.name, kind: row.kind, targetHint: this.hint(row.kind, target), events: row.events,
            enabled: row.enabled, lastStatus: row.last_status, lastError: row.last_error, lastAt: row.last_at,
        };
    }

    /** @returns Every webhook (without secrets). */
    public async list(): Promise<WebhookView[]> {
        const result = await this.pool.query("SELECT * FROM webhooks ORDER BY id");
        return result.rows.map((row) => this.view(row));
    }

    /** @param id Webhook id. @returns The webhook (without secrets), or null. */
    public async find(id: number): Promise<WebhookView | null> {
        const result = await this.pool.query("SELECT * FROM webhooks WHERE id = $1", [id]);
        return result.rows[0] ? this.view(result.rows[0]) : null;
    }

    private cleanEvents(events: unknown): string[] {
        if (!Array.isArray(events) || events.length === 0 || events.some((e) => typeof e !== "string" || !EVENT_IDS.includes(e))) {
            throw new ValidationError("Choose at least one event.");
        }
        return [...new Set(events as string[])];
    }

    /**
     * @param input The webhook.
     * @param adminId Admin creating it.
     * @returns The new id.
     */
    public async create(input: WebhookInput, adminId: number): Promise<number> {
        const name = input.name?.trim();
        if (!name || name.length > 60) throw new ValidationError("Give it a name of up to 60 characters.");
        validateTarget(input.kind, input.target);
        const result = await this.pool.query(
            "INSERT INTO webhooks (name, kind, target, events, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id",
            [name, input.kind, this.crypto.encrypt(JSON.stringify(input.target)), this.cleanEvents(input.events), adminId]
        );
        return result.rows[0].id;
    }

    /**
     * Changes a webhook. Without a new `target` the stored secret stays as it is.
     * @param id Webhook id.
     * @param input New values.
     * @returns Whether it exists.
     */
    public async update(id: number, input: {name: string; events: string[]; target?: WebhookTarget}): Promise<boolean> {
        const existing = (await this.pool.query("SELECT kind FROM webhooks WHERE id = $1", [id])).rows[0];
        if (!existing) return false;
        const name = input.name?.trim();
        if (!name || name.length > 60) throw new ValidationError("Give it a name of up to 60 characters.");
        const events = this.cleanEvents(input.events);
        if (input.target) {
            validateTarget(existing.kind, input.target);
            await this.pool.query("UPDATE webhooks SET name = $2, events = $3, target = $4 WHERE id = $1", [id, name, events, this.crypto.encrypt(JSON.stringify(input.target))]);
        } else {
            await this.pool.query("UPDATE webhooks SET name = $2, events = $3 WHERE id = $1", [id, name, events]);
        }
        return true;
    }

    /** @param id Webhook id. @param enabled New state. @returns Whether it exists. */
    public async setEnabled(id: number, enabled: boolean): Promise<boolean> {
        const result = await this.pool.query("UPDATE webhooks SET enabled = $2 WHERE id = $1", [id, enabled]);
        return (result.rowCount ?? 0) > 0;
    }

    /** @param id Webhook id. @returns Whether it existed. */
    public async remove(id: number): Promise<boolean> {
        const result = await this.pool.query("DELETE FROM webhooks WHERE id = $1", [id]);
        return (result.rowCount ?? 0) > 0;
    }

    /** @param id Webhook id. @returns Its last deliveries, newest first. */
    public async deliveries(id: number): Promise<WebhookDelivery[]> {
        const result = await this.pool.query(
            `SELECT id, event, status, http_status AS "httpStatus", error, created_date AS "createdDate"
               FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY id DESC LIMIT 30`, [id]);
        return result.rows;
    }

    /** Deletes old delivery records. @param before Cut-off. */
    public async purge(before: Date): Promise<void> {
        await this.pool.query("DELETE FROM webhook_deliveries WHERE created_date < $1", [before]);
    }

    /**
     * Sends a message about an event to every enabled webhook subscribed to it. Never throws.
     * @param event What happened.
     * @param message What to say.
     */
    public async emit(event: WebhookEvent, message: WebhookMessage): Promise<void> {
        if (!this.enabled) return;
        try {
            if (message.dedupeKey && message.cooldownMs) {
                const key = `${event}:${message.dedupeKey}`;
                const last = this.cooldown.get(key);
                if (last && Date.now() - last < message.cooldownMs) return;
                this.cooldown.set(key, Date.now());
            }
            const rows = (await this.pool.query("SELECT * FROM webhooks WHERE enabled AND $1 = ANY(events)", [event])).rows;
            await Promise.all(rows.map((row) => this.deliver(row, event, message)));
        } catch (error) {
            this.logger.error(`Webhook event ${event} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Sends a test message to one webhook.
     * @param id Webhook id.
     * @returns The outcome, or null when it doesn't exist.
     */
    public async test(id: number): Promise<{ok: boolean; error: string | null} | null> {
        const row = (await this.pool.query("SELECT * FROM webhooks WHERE id = $1", [id])).rows[0];
        if (!row) return null;
        return this.deliver(row, "test", {title: "Test message from the Vaultisse admin portal", lines: ["If you can read this, the webhook works."]});
    }

    private text(message: WebhookMessage, bold: (s: string) => string, escape: (s: string) => string): string {
        const body = [bold(escape(message.title)), ...message.lines.map(escape)].join("\n");
        const url = appService.getAdminConfig().url;
        const full = url ? `${body}\n${url}` : body;
        return full.length > MAX_TEXT ? `${full.slice(0, MAX_TEXT - 1)}…` : full;
    }

    private async deliver(row: any, event: string, message: WebhookMessage): Promise<{ok: boolean; error: string | null}> {
        let httpStatus: number | null = null;
        let error: string | null = null;
        try {
            const target: WebhookTarget = JSON.parse(this.crypto.decrypt(row.target));
            const kind: WebhookKind = row.kind;
            let url: string;
            let body: unknown;
            const headers: Record<string, string> = {"Content-Type": "application/json", "User-Agent": "Vaultisse-Admin-Webhook"};
            if (kind === "slack") {
                url = target.url!;
                body = {text: this.text(message, (s) => `*${s}*`, (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))};
            } else if (kind === "discord") {
                url = target.url!;
                body = {content: this.text(message, (s) => `**${s}**`, (s) => s), allowed_mentions: {parse: []}};
            } else if (kind === "telegram") {
                url = `https://api.telegram.org/bot${target.token}/sendMessage`;
                body = {chat_id: target.chatId, text: this.text(message, (s) => s, (s) => s), disable_web_page_preview: true};
            } else {
                url = target.url!;
                await assertPublicHost(new URL(url));
                body = {event, title: message.title, lines: message.lines, instance: appService.getInstanceUuid(), sentAt: new Date().toISOString()};
                headers["X-Vaultisse-Event"] = event;
                if (target.secret) {
                    headers["X-Vaultisse-Signature"] = `sha256=${crypto.createHmac("sha256", target.secret).update(JSON.stringify(body)).digest("hex")}`;
                }
            }
            const response = await axios.post(url, body, {headers, timeout: TIMEOUT_MS, maxRedirects: 0, validateStatus: () => true});
            httpStatus = response.status;
            if (response.status < 200 || response.status >= 300 || (kind === "telegram" && response.data?.ok === false)) {
                error = kind === "telegram" && response.data?.description ? String(response.data.description) : `The service answered HTTP ${response.status}.`;
            }
        } catch (e) {
            error = e instanceof Error ? e.message.replace(/bot\d+:[\w-]+/g, "bot…") : String(e);
        }
        const status = error === null ? "sent" : "failed";
        try {
            await this.pool.query("INSERT INTO webhook_deliveries (webhook_id, event, status, http_status, error) VALUES ($1, $2, $3, $4, $5)", [row.id, event, status, httpStatus, error?.slice(0, 500) ?? null]);
            await this.pool.query("UPDATE webhooks SET last_status = $2, last_error = $3, last_at = CURRENT_TIMESTAMP WHERE id = $1", [row.id, status, error?.slice(0, 500) ?? null]);
        } catch (e) {
            this.logger.error(`Recording a webhook delivery failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        return {ok: error === null, error};
    }
}
