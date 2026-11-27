/**
 * How exposed the admin console is, as far as the server can tell from inside: whether the admin reading this is connecting
 * from the public internet, whether anything limits who can reach it, and whether it is served over HTTPS.
 *
 * The recommendation never changes (keep the console off the internet: use it locally, over a VPN or an SSH tunnel), but the
 * console can be much louder about it when it sees that it is being reached from the internet with nothing in the way.
 *
 * "From the internet" means the client address is a public one. Behind a reverse proxy the real client address is only known
 * with TRUST_PROXY=true; without it every visitor looks like the proxy, which is a private address, so it reads as local.
 */
import {Request} from "express";
import {appService} from "../../AppService";
import {isPublicAddress} from "./AutoBlocker";

export interface ConnectionInfo {
    fromInternet: boolean;
    address: string | null;
    restrictedByIp: boolean;
    https: boolean;
}

/**
 * @param req The request.
 * @returns How this request reached the console.
 * @example
 *   // an admin at the office opening http://192.168.1.20:3001   -> {fromInternet: false, address: "192.168.1.20", restrictedByIp: false, https: false}
 *   // an admin on a hotel network opening https://adm.example.com -> {fromInternet: true, address: "203.0.113.4", restrictedByIp: false, https: true}
 */
export function describeConnection(req: Request): ConnectionInfo {
    const config = appService.getAdminConfig();
    const raw = req.ip ?? "";
    const address = raw.startsWith("::ffff:") ? raw.slice(7) : raw;
    return {
        fromInternet: address !== "" && isPublicAddress(address),
        address: address || null,
        restrictedByIp: config.allowedIps.length > 0,
        https: req.secure || (config.url ?? "").startsWith("https://"),
    };
}

/**
 * @param req The request.
 * @returns What the System page shows under "Who can reach this console" (never the addresses of the allowlist, only how many).
 */
export function describeExposure(req: Request): {restrictedByIp: boolean; allowedCount: number; publicUrl: string | null; https: boolean; trustProxy: boolean; fromInternet: boolean; yourAddress: string | null} {
    const config = appService.getAdminConfig();
    const connection = describeConnection(req);
    return {
        restrictedByIp: connection.restrictedByIp,
        allowedCount: config.allowedIps.length,
        publicUrl: config.url,
        https: connection.https,
        trustProxy: process.env.TRUST_PROXY === "true",
        fromInternet: connection.fromInternet,
        yourAddress: connection.address,
    };
}
