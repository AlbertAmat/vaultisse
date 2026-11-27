/**
 * The compliance catalogue: the controls of ISO/IEC 27001:2022 (Annex A) that an installation of this app can
 * evidence, mapped to the matching GDPR articles and SOC 2 criteria.
 *
 * A control either has a live check (the portal measures it from the configuration and the database) or none
 * (a person declares its status and keeps the evidence). The catalogue is code, so it follows the version of the
 * app; what people record about each control is stored in the database (`compliance_controls`).
 *
 * This is a working aid, not a certification: passing every check does not make an installation "ISO certified".
 */

export type CheckState = "pass" | "warn" | "fail";
export interface CheckResult {
    state: CheckState;
    detail: string;
}

/** Everything the checks may look at, gathered once per request by {@link ComplianceService}. */
export interface Facts {
    admins: {total: number; superadmins: number; without2fa: number; neverReviewed: number; staleReview: number; reviewDays: number};
    audit: {appendOnly: boolean; entries30d: number; changes30d: number};
    security: {events30d: number; autoBlock: boolean; allowedIps: number; blockedNow: number};
    users: {total: number; with2fa: number; tosAccepted: number};
    config: {
        https: boolean;
        adminHttps: boolean;
        encryptionKey: boolean;
        mailConfigured: boolean;
        inactivityDays: number;
        deletionGraceDays: number;
        adminAlerts: boolean;
        dbSizeAlert: boolean;
        updateCheck: boolean;
        sessionHours: number;
        separatePort: boolean;
    };
    update: {known: boolean; available: boolean | null; installed: string; latest: string | null};
    incidents: {total: number; open: number; overdueNotification: number};
    register: Record<"policy" | "supplier" | "risk" | "asset", {active: number; overdue: number}>;
    highRisks: number;
    dataRequests: {open: number; overdue: number};
    /** Retention: how long personal logs are kept (0 = forever) and how many background jobs failed last time. */
    retention: {activityDays: number; securityDays: number; mailDays: number};
    jobsFailing: number;
}

export interface ControlDef {
    id: string;
    title: string;
    area: "Organisational" | "People" | "Physical" | "Technological";
    /** What the control asks for, in one sentence. */
    summary: string;
    /** What to do or keep for it when the portal can't measure it (or on top of what it measures). */
    howTo: string;
    refs: {gdpr?: string; soc2?: string};
    check?: (facts: Facts) => CheckResult;
}

const pass = (detail: string): CheckResult => ({state: "pass", detail});
const warn = (detail: string): CheckResult => ({state: "warn", detail});
const fail = (detail: string): CheckResult => ({state: "fail", detail});
const plural = (n: number, one: string, many: string = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function register(kind: "policy" | "supplier" | "risk" | "asset", noun: string) {
    return (f: Facts): CheckResult => {
        const r = f.register[kind];
        if (r.active === 0) return warn(`No ${noun} is listed yet. Add them under Compliance > Registers.`);
        if (r.overdue > 0) return fail(`${plural(r.overdue, noun)} past the review date.`);
        return pass(`${plural(r.active, noun)} listed, all within their review date.`);
    };
}

export const COMPLIANCE_CATALOG: ControlDef[] = [
    // ---- Organisational (A.5) ----
    {
        id: "A.5.1", title: "Policies for information security", area: "Organisational",
        summary: "An information security policy, approved by management, published and reviewed at planned intervals.",
        howTo: "Keep each policy (information security, access control, backup, incident response, acceptable use) in Registers > Policies, with an approval date and the next review.",
        refs: {soc2: "CC5.3"}, check: register("policy", "policy"),
    },
    {
        id: "A.5.9", title: "Inventory of information and other associated assets", area: "Organisational",
        summary: "An inventory of the information and assets that carry it, each with an owner.",
        howTo: "List the servers, databases, backups, domains and services in Registers > Assets, each with an owner and how critical it is.",
        refs: {gdpr: "Art. 30"}, check: register("asset", "asset"),
    },
    {
        id: "A.5.15", title: "Access control", area: "Organisational",
        summary: "Rules for who may access what, based on business and security needs.",
        howTo: "Write the access control policy and register it. Each person is an account of their own: no shared logins.",
        refs: {soc2: "CC6.1"},
        check: (f) => f.admins.superadmins > 0
            ? pass(`Admin access is role based (${plural(f.admins.superadmins, "full admin")}, ${plural(f.admins.total - f.admins.superadmins, "read-only admin")}). Tenants can't be browsed by admins.`)
            : fail("No active full admin."),
    },
    {
        id: "A.5.16", title: "Identity management", area: "Organisational",
        summary: "The full life cycle of identities is managed: created, changed and removed.",
        howTo: "Remove an admin when the person leaves (Admins > Remove). Account removal for users goes through Deletions.",
        refs: {soc2: "CC6.2"},
        check: (f) => pass(`${plural(f.admins.total, "admin account")}, each with its own identity and recorded in the audit trail. Deletions of user accounts are scheduled, cancellable and audited.`),
    },
    {
        id: "A.5.17", title: "Authentication information", area: "Organisational",
        summary: "Passwords and other authentication data are allocated and managed securely.",
        howTo: "",
        refs: {soc2: "CC6.1"},
        check: (f) => f.admins.without2fa > 0
            ? warn(`${plural(f.admins.without2fa, "admin")} still has to enrol two-factor authentication.`)
            : pass("Admin passwords need 12 characters or more, are stored hashed, a generated first password must be changed at first login, and two-factor is mandatory."),
    },
    {
        id: "A.5.18", title: "Access rights", area: "Organisational",
        summary: "Access rights are provisioned, reviewed, changed and removed in line with the access control policy.",
        howTo: "Review who has admin access at least every few months: open Compliance > Access review and confirm each admin still needs it.",
        refs: {soc2: "CC6.3"},
        check: (f) => f.admins.neverReviewed > 0
            ? warn(`${plural(f.admins.neverReviewed, "admin")} never had an access review.`)
            : f.admins.staleReview > 0
                ? fail(`${plural(f.admins.staleReview, "admin")} not reviewed in the last ${f.admins.reviewDays} days.`)
                : pass(`Every admin was reviewed in the last ${f.admins.reviewDays} days.`),
    },
    {
        id: "A.5.19", title: "Information security in supplier relationships", area: "Organisational",
        summary: "The risks of using suppliers are managed. Under GDPR, processors need a contract (art. 28).",
        howTo: "List every supplier that handles your data (hosting, email delivery, backups, DNS) in Registers > Suppliers, with a link to the contract or data processing agreement.",
        refs: {gdpr: "Art. 28", soc2: "CC9.2"}, check: register("supplier", "supplier"),
    },
    {
        id: "A.5.24", title: "Incident management planning and preparation", area: "Organisational",
        summary: "Roles, processes and a way to record security incidents are in place.",
        howTo: "Write the incident response procedure (who decides, who is told, within what time) and register it as a policy.",
        refs: {gdpr: "Art. 33, 34", soc2: "CC7.3"},
        check: (f) => f.config.adminAlerts && f.config.mailConfigured
            ? pass("A register of incidents is available, and admins are emailed about security problems.")
            : warn("The register is available, but admins aren't emailed about problems: set up email and keep the security alerts on (Settings)."),
    },
    {
        id: "A.5.26", title: "Response to information security incidents", area: "Organisational",
        summary: "Incidents are answered according to the documented procedures and recorded. A personal-data breach must be reported to the authority within 72 hours.",
        howTo: "Record every incident in Compliance > Incidents, including what was done and what was learned.",
        refs: {gdpr: "Art. 33", soc2: "CC7.4"},
        check: (f) => f.incidents.overdueNotification > 0
            ? fail(`${plural(f.incidents.overdueNotification, "personal-data incident")} not reported to the authority within 72 hours.`)
            : f.incidents.open > 0
                ? warn(`${plural(f.incidents.open, "incident")} still open.`)
                : pass(f.incidents.total === 0 ? "No incident recorded, and none open." : `${plural(f.incidents.total, "incident")} recorded, none open.`),
    },
    {
        id: "A.5.29", title: "Information security during disruption", area: "Organisational",
        summary: "How security is kept up when something goes wrong or the service is interrupted.",
        howTo: "Document how to restore the service (restore a backup, redeploy the container) and test it. Maintenance mode lets you stop writes cleanly.",
        refs: {soc2: "A1.3"},
    },
    {
        id: "A.5.31", title: "Legal, statutory, regulatory and contractual requirements", area: "Organisational",
        summary: "The legal and contractual requirements are identified, documented and kept up to date.",
        howTo: "Keep a list of the laws and contracts that apply (GDPR, local rules, customer contracts) as a policy in Registers.",
        refs: {gdpr: "Art. 5(2)"},
        check: (f) => f.users.total === 0 ? warn("No accounts yet.") : f.users.tosAccepted < f.users.total
            ? warn(`${f.users.tosAccepted} of ${f.users.total} accounts accepted the current Terms of Service (see Terms & notices).`)
            : pass(`All ${f.users.total} accounts accepted the current Terms of Service.`),
    },
    {
        id: "A.5.34", title: "Privacy and protection of personal information", area: "Organisational",
        summary: "Personal data is protected as the law and contracts require.",
        howTo: "Keep the record of processing activities (GDPR art. 30) as a policy document, and answer access and erasure requests within a month.",
        refs: {gdpr: "Art. 5, 25, 30"},
        check: (f) => f.dataRequests.overdue > 0
            ? fail(`${plural(f.dataRequests.overdue, "data request")} past the one-month deadline (GDPR art. 12). See Data requests.`)
            : f.retention.activityDays === 0
            ? warn("The sign-in log (with addresses) is kept forever. Choose a period on the Data retention page: storage limitation, GDPR art. 5(1)(e).")
            : f.config.inactivityDays > 0
            ? pass(`Accounts unused for ${f.config.inactivityDays} days are removed (storage limitation). Admins can't read the libraries of the users. Access and erasure requests are tracked against their deadline${f.dataRequests.open ? ` (${f.dataRequests.open} open)` : ""}.`)
            : warn("Inactive accounts are kept forever. Set ACCOUNT_INACTIVITY_DAYS to apply storage limitation (Settings > Inactive accounts)."),
    },
    {
        id: "A.5.36", title: "Compliance with policies, rules and standards", area: "Organisational",
        summary: "Compliance with the policies is reviewed regularly.",
        howTo: "Review each control at least once a year: set an owner and the next review date on it, and mark it reviewed.",
        refs: {soc2: "CC4.1"},
    },
    // ---- People (A.6) ----
    {
        id: "A.6.3", title: "Information security awareness, education and training", area: "People",
        summary: "Everybody with access receives training and regular updates on the policies.",
        howTo: "Keep a record of who was trained and when (an attachment link in the evidence field is enough).",
        refs: {soc2: "CC1.4"},
    },
    // ---- Physical (A.7) ----
    {
        id: "A.7.1", title: "Physical security perimeters", area: "Physical",
        summary: "Areas with information and the systems that process it are protected.",
        howTo: "Where you host yourself: describe the room and who has access. In a hosted environment, point to the provider's certificate (ISO 27001, SOC 2) as evidence.",
        refs: {soc2: "CC6.4"},
    },
    // ---- Technological (A.8) ----
    {
        id: "A.8.2", title: "Privileged access rights", area: "Technological",
        summary: "Privileged access (the admin portal) is limited and managed.",
        howTo: "Keep full admins to the few who need it; give the others a read-only role.",
        refs: {soc2: "CC6.3"},
        check: (f) => f.admins.superadmins > 3
            ? warn(`${f.admins.superadmins} full admins. Consider fewer, or read-only roles.`)
            : pass(`${plural(f.admins.superadmins, "full admin")}. Dangerous actions ask for the password and a code again.`),
    },
    {
        id: "A.8.3", title: "Information access restriction", area: "Technological",
        summary: "Access to information follows the access control policy.",
        howTo: "",
        refs: {gdpr: "Art. 25, 32", soc2: "CC6.1"},
        check: () => pass("By design the admin portal exposes no book, note, loan or customer data: it manages accounts, vaults and settings only."),
    },
    {
        id: "A.8.5", title: "Secure authentication", area: "Technological",
        summary: "Authentication is secure, with lockout and multi-factor where it matters.",
        howTo: "",
        refs: {gdpr: "Art. 32", soc2: "CC6.1"},
        check: (f) => f.users.total > 0
            ? pass(`Admin sign-in needs a second factor and locks after repeated failures. ${Math.round((100 * f.users.with2fa) / f.users.total)}% of the users (${f.users.with2fa} of ${f.users.total}) use two-factor.`)
            : pass("Admin sign-in needs a second factor and locks after repeated failures."),
    },
    {
        id: "A.8.6", title: "Capacity management", area: "Technological",
        summary: "Resources are monitored and adjusted to the demand.",
        howTo: "",
        refs: {soc2: "A1.1"},
        check: (f) => f.config.dbSizeAlert ? pass("An alert is sent when the database passes the size you set.") : warn("No database size alert. Set ADMIN_NOTIFY_DB_SIZE_MB (Settings > Admin notifications)."),
    },
    {
        id: "A.8.8", title: "Management of technical vulnerabilities", area: "Technological",
        summary: "Vulnerabilities are found and fixed in time, which includes running a supported, patched version.",
        howTo: "Update the container image regularly and read the release notes for security fixes.",
        refs: {soc2: "CC7.1"},
        check: (f) => !f.config.updateCheck ? warn("The update check is off, so a new version won't be noticed.")
            : f.update.available === true ? fail(`Version ${f.update.latest} is available (installed ${f.update.installed}).`)
                : f.update.known ? pass(`Running ${f.update.installed}, the latest published version.`)
                    : warn("The latest version couldn't be checked right now."),
    },
    {
        id: "A.8.9", title: "Configuration management", area: "Technological",
        summary: "Configurations are documented, applied, monitored and reviewed.",
        howTo: "",
        refs: {soc2: "CC8.1"},
        check: (f) => pass(`Settings are edited in one place and every change is recorded in the audit trail (${plural(f.audit.changes30d, "change")} in the last 30 days). The startup log shows which value is in force.`),
    },
    {
        id: "A.8.10", title: "Information deletion", area: "Technological",
        summary: "Information is deleted when it is no longer needed.",
        howTo: "",
        refs: {gdpr: "Art. 5(1)(e), 17", soc2: "C1.2"},
        check: (f) => f.config.inactivityDays > 0
            ? pass(`Deletions of accounts and vaults run after a ${f.config.deletionGraceDays}-day grace period; inactive accounts are removed after ${f.config.inactivityDays} days.`)
            : warn(`Deletions run after a ${f.config.deletionGraceDays}-day grace period, but inactive accounts are never removed automatically.`),
    },
    {
        id: "A.8.13", title: "Information backup", area: "Technological",
        summary: "Backups of the data are made and tested regularly.",
        howTo: "Back up the PostgreSQL database and the uploaded files (the data volume) outside the server, and restore one to test it. Put the schedule and the last restore test in the evidence.",
        refs: {soc2: "A1.2"},
    },
    {
        id: "A.8.15", title: "Logging", area: "Technological",
        summary: "Logs of activities and events are produced, kept and protected from tampering.",
        howTo: "",
        refs: {gdpr: "Art. 32", soc2: "CC7.2"},
        check: (f) => !f.audit.appendOnly
            ? fail("The audit trail isn't protected against changes (its database triggers are missing).")
            : pass(`Admin actions are written to a tamper-resistant audit trail (${plural(f.audit.entries30d, "entry", "entries")} in 30 days). Sign-ins, failed logins and emails are logged too.`),
    },
    {
        id: "A.8.16", title: "Monitoring activities", area: "Technological",
        summary: "Systems are monitored for abnormal behaviour and the right people are told.",
        howTo: "",
        refs: {soc2: "CC7.2"},
        check: (f) => f.jobsFailing > 0 ? warn(`${plural(f.jobsFailing, "background job")} failed on the last run. See Jobs.`)
            : !f.config.mailConfigured ? warn("Email isn't set up, so admins can't be alerted.")
            : !f.config.adminAlerts ? warn("Alerts for security problems are off (Settings > Admin notifications).")
                : pass(`Security events are counted (${f.security.events30d} in 30 days) and admins are emailed about problems.`),
    },
    {
        id: "A.8.20", title: "Networks security", area: "Technological",
        summary: "Networks and network services are secured and controlled.",
        howTo: "Put a reverse proxy or CDN with DDoS protection in front of the app; this app can't absorb a flood itself.",
        refs: {gdpr: "Art. 32", soc2: "CC6.6"},
        check: (f) => {
            const parts = [f.config.separatePort ? "The admin portal listens on its own port" : "", f.security.autoBlock ? "failed logins are blocked automatically" : "", f.security.allowedIps > 0 ? `the portal only answers ${plural(f.security.allowedIps, "address", "addresses")}` : ""].filter(Boolean);
            return f.security.allowedIps > 0 || f.security.autoBlock
                ? pass(`${parts.join("; ")}.`)
                : warn("Nothing restricts who can reach the portal. Set ADMIN_ALLOWED_IPS, or turn on automatic blocking (Security).");
        },
    },
    {
        id: "A.8.24", title: "Use of cryptography", area: "Technological",
        summary: "Data in transit and secrets at rest are protected with cryptography.",
        howTo: "Make sure disks and backups are encrypted too.",
        refs: {gdpr: "Art. 32", soc2: "CC6.7"},
        check: (f) => !f.config.https || !f.config.adminHttps ? fail("The app or the admin portal isn't served over HTTPS.")
            : !f.config.encryptionKey ? warn("Secrets saved in the portal are encrypted with a key derived from the JWT secret. Set SETTINGS_ENCRYPTION_KEY to use a dedicated key.")
                : pass("Everything is served over HTTPS, passwords are hashed and secrets saved in the portal are encrypted with a dedicated key."),
    },
    {
        id: "A.8.26", title: "Application security requirements", area: "Technological",
        summary: "Security requirements are identified and applied when building and running the application.",
        howTo: "",
        refs: {gdpr: "Art. 25", soc2: "CC8.1"},
        check: () => pass("The portal sends a strict content security policy, accepts changes only from its own origin, rate-limits sign-in and keeps sessions in HttpOnly SameSite cookies."),
    },
    {
        id: "A.8.32", title: "Change management", area: "Technological",
        summary: "Changes to systems follow a change management process.",
        howTo: "Keep the release process (review, tests, who approves a deployment) as a policy. Announce planned downtime with an announcement or maintenance mode.",
        refs: {soc2: "CC8.1"},
    },
];

/** @returns The ids of every control in the catalogue. */
export function controlIds(): string[] {
    return COMPLIANCE_CATALOG.map((c) => c.id);
}
