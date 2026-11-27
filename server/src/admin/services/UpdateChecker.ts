/**
 * Finds out whether a newer Vaultisse release exists, by asking GitHub for the latest release. The result
 * is cached for six hours. Nothing about this installation is sent (no id, no version): it is an
 * anonymous read of a public page. Can be switched off with ADMIN_UPDATE_CHECK=false in the portal.
 */
import axios from "axios";

const REPOSITORY = "AlbertAmat/vaultisse";
const CACHE_MS = 6 * 60 * 60 * 1000;

export interface UpdateStatus {
    /** The version this server runs ("dev" for a development build). */
    installed: string;
    /** True for a build that isn't a release (APP_VERSION unset or not a version number). */
    isDevBuild: boolean;
    checkEnabled: boolean;
    latest: string | null;
    /** Null when it can't be told (check off, failed, or a development build). */
    updateAvailable: boolean | null;
    releaseUrl: string | null;
    publishedAt: string | null;
    checkedAt: string | null;
    error: string | null;
}

/** @returns [major, minor, patch] of the first x.y.z in `version`, or null. */
function parse(version: string): [number, number, number] | null {
    const match = /(\d+)\.(\d+)\.(\d+)/.exec(version);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/**
 * @param a Version string.
 * @param b Version string.
 * @returns Whether `a` is a newer release than `b`.
 */
export function isNewer(a: string, b: string): boolean {
    const left = parse(a);
    const right = parse(b);
    if (!left || !right) {
        return false;
    }
    for (let i = 0; i < 3; i++) {
        if (left[i] !== right[i]) {
            return left[i] > right[i];
        }
    }
    return false;
}

/** Cached "is there a newer version" lookup. */
export class UpdateChecker {
    private cache: {at: number; latest: string | null; url: string | null; publishedAt: string | null; error: string | null} | null = null;

    /**
     * @param installed Installed version (APP_VERSION).
     * @param enabled Reads the current ADMIN_UPDATE_CHECK setting.
     */
    public constructor(private readonly installed: () => string, private readonly enabled: () => boolean) {
    }

    /**
     * @param force Ask GitHub again even if the cached answer is fresh.
     * @returns The version status.
     */
    public async status(force: boolean = false): Promise<UpdateStatus> {
        const installed = this.installed();
        const isDevBuild = parse(installed) === null;
        const checkEnabled = this.enabled();
        if (checkEnabled && (force || !this.cache || Date.now() - this.cache.at > CACHE_MS)) {
            await this.refresh();
        }
        const cache = checkEnabled ? this.cache : null;
        const latest = cache?.latest ?? null;
        return {
            installed,
            isDevBuild,
            checkEnabled,
            latest,
            updateAvailable: !checkEnabled || isDevBuild || !latest ? null : isNewer(latest, installed),
            releaseUrl: cache?.url ?? null,
            publishedAt: cache?.publishedAt ?? null,
            checkedAt: cache ? new Date(cache.at).toISOString() : null,
            error: cache?.error ?? null,
        };
    }

    private async refresh(): Promise<void> {
        try {
            const res = await axios.get(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
                timeout: 8000,
                headers: {Accept: "application/vnd.github+json", "User-Agent": "vaultisse-update-check"},
                validateStatus: () => true,
            });
            if (res.status === 200 && res.data?.tag_name) {
                this.cache = {at: Date.now(), latest: String(res.data.tag_name).replace(/^v/i, ""), url: res.data.html_url ?? null, publishedAt: res.data.published_at ?? null, error: null};
            } else if (res.status === 404) {
                this.cache = {at: Date.now(), latest: null, url: null, publishedAt: null, error: "No release has been published yet."};
            } else {
                this.cache = {at: Date.now(), latest: null, url: null, publishedAt: null, error: `GitHub answered with HTTP ${res.status}.`};
            }
        } catch (error) {
            this.cache = {at: Date.now(), latest: null, url: null, publishedAt: null, error: `Couldn't reach GitHub (${error instanceof Error ? error.message : String(error)}).`};
        }
    }
}
