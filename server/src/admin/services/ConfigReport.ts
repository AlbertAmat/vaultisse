/**
 * The "configuration in effect" table printed in the container output at start-up (and reusable elsewhere):
 * for each setting, what the environment variable says, what the admin portal says, and which one is
 * actually applied. The rule is simple: **the admin portal wins over the environment variable**, so
 * whenever both are set the env var is ignored, which is exactly the case this table makes visible.
 */

export interface ConfigRow {
    key: string;
    /** Display value of the env var, or null when it isn't set. Secrets show as "(set)". */
    envValue: string | null;
    /** Display value saved in the portal, or null when nothing is saved. */
    panelValue: string | null;
    applied: "panel" | "env" | "default";
    /** Both are set and differ, so the env var is being ignored. */
    conflict: boolean;
}

const WIDTH_LIMIT = 34;

function cell(value: string | null): string {
    if (value === null) {
        return "-";
    }
    const text = value === "" ? "(empty)" : value;
    return text.length > WIDTH_LIMIT ? `${text.slice(0, WIDTH_LIMIT - 1)}…` : text;
}

/**
 * @param rows One row per setting.
 * @returns The lines of the table, ready to print.
 */
export function formatConfigTable(rows: ConfigRow[]): string[] {
    const shown = rows.filter((row) => row.envValue !== null || row.panelValue !== null);
    const defaults = rows.length - shown.length;
    const line = "=".repeat(110);
    const out: string[] = ["", line, "  ADMIN PORTAL - configuration in effect", "  Settings saved in the admin portal take priority over environment variables.", ""];

    if (shown.length === 0) {
        out.push("  No setting is configured in the environment or in the admin portal: everything uses its default.");
    } else {
        const headers = ["SETTING", "ENV VAR", "ADMIN PANEL", "APPLIED", "NOTE"];
        const table = shown.map((row) => [
            row.key,
            cell(row.envValue),
            cell(row.panelValue),
            row.applied === "panel" ? "admin panel" : row.applied === "env" ? "env var" : "default",
            row.conflict ? "env var IGNORED (the admin panel overrides it)" : "",
        ]);
        const widths = headers.map((header, i) => Math.max(header.length, ...table.map((cols) => cols[i].length)));
        const format = (cols: string[]) => "  " + cols.map((col, i) => col.padEnd(widths[i])).join("  ").trimEnd();
        out.push(format(headers), "  " + widths.map((w) => "-".repeat(w)).join("  "), ...table.map(format));
    }

    const ignored = shown.filter((row) => row.conflict).length;
    out.push("");
    if (ignored > 0) {
        out.push(`  ${ignored} environment ${ignored === 1 ? "variable is" : "variables are"} being ignored because the admin panel sets ${ignored === 1 ? "that value" : "those values"}.`);
        out.push("  To use the environment variables again: Admin console > Settings > Danger zone > Reset configuration.");
    }
    if (defaults > 0) {
        out.push(`  ${defaults} other ${defaults === 1 ? "setting uses its" : "settings use their"} default.`);
    }
    out.push(line, "");
    return out;
}
