/** Display helpers. */

/** @param iso ISO date string. @returns Local date and time, or an em dash. */
export function dateTime(iso: string | null | undefined): string {
    return iso ? new Date(iso).toLocaleString(undefined, {dateStyle: "medium", timeStyle: "short"}) : "—";
}

/** @param iso ISO date string. @returns Local date, or an em dash. */
export function dateOnly(iso: string | null | undefined): string {
    return iso ? new Date(iso).toLocaleDateString(undefined, {dateStyle: "medium"}) : "—";
}

/** @param iso ISO date string. @returns "5 min ago" / "in 3 days" style text, or an em dash. */
export function relative(iso: string | null | undefined): string {
    if (!iso) {
        return "—";
    }
    const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
    const units: [Intl.RelativeTimeFormatUnit, number][] = [["day", 86400], ["hour", 3600], ["minute", 60]];
    const formatter = new Intl.RelativeTimeFormat(undefined, {numeric: "auto"});
    for (const [unit, size] of units) {
        if (Math.abs(seconds) >= size) {
            return formatter.format(Math.round(seconds / size), unit);
        }
    }
    return formatter.format(seconds, "second");
}

/** @param value Number of bytes. @returns "1.2 MB" style text. */
export function bytes(value: number): string {
    if (value < 1024) {
        return `${value} B`;
    }
    const units = ["KB", "MB", "GB", "TB"];
    let size = value / 1024;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit++;
    }
    return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unit]}`;
}

/** @param value Number. @returns Locale-grouped number. */
export function num(value: number | null | undefined): string {
    return value === null || value === undefined ? "—" : value.toLocaleString();
}

/** @param seconds Duration. @returns "3d 4h" / "12m" style text. */
export function duration(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}
