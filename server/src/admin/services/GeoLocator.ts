/**
 * Turns an IP address into an approximate place (country, region, city, coordinates) for the login map.
 *
 * It looks addresses up in the database bundled with the `geoip-lite` package, entirely on this server: no
 * address is ever sent to a third party. The accuracy is that of a free database - the right country almost
 * always, the right city often, never a street - and the data is as old as the installed package.
 *
 * The database is loaded into memory on the first lookup, not at start-up, so an installation that never opens the
 * map doesn't pay for it.
 */
import net from "net";
import {isPublicAddress} from "./AutoBlocker";

export interface GeoPlace {
    lat: number;
    lon: number;
    country: string;
    region: string;
    city: string;
}

type Lookup = (ip: string) => {country: string; region: string; city: string; ll: [number, number]} | null;

let lookupFn: Lookup | null | undefined;

function load(): Lookup | null {
    if (lookupFn === undefined) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            lookupFn = (require("geoip-lite") as {lookup: Lookup}).lookup;
        } catch {
            lookupFn = null;
        }
    }
    return lookupFn;
}

/** @returns Whether the location database could be loaded. */
export function geoAvailable(): boolean {
    return load() !== null;
}

/**
 * @param ip Address as stored (may carry the `::ffff:` prefix of an IPv4 address seen on a dual-stack socket).
 * @returns Its place, or null for a private/local address, an invalid one, or one the database doesn't know.
 */
export function locate(ip: string): GeoPlace | null {
    const address = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
    const lookup = load();
    if (!lookup || net.isIP(address) === 0 || !isPublicAddress(address)) {
        return null;
    }
    const found = lookup(address);
    if (!found || !Array.isArray(found.ll) || found.ll.length !== 2) {
        return null;
    }
    return {lat: found.ll[0], lon: found.ll[1], country: found.country, region: found.region, city: found.city};
}
