/**
 * Command-line administration, for what can't be done from the portal itself: creating the first admin and
 * recovering from a lost password or authenticator. Run inside the app's container/checkout:
 *
 *   node index.js admin:create --email you@example.com [--name "Your Name"]
 *   node index.js admin:reset  --email you@example.com
 *
 * The password is asked for on the terminal (not shown). For scripts, `ADMIN_PASSWORD` in the environment
 * is used instead. `admin:reset` sets a new password and removes the admin's two-factor, so they enrol again
 * at their next login. Both commands bring the database schema up to date first, so they work on a fresh install.
 */
import readline from "readline";
import {appService} from "../AppService";
import {ConflictError, ValidationError} from "../errors/DomainError";
import {runMigrations} from "../migrate";
import {AdminAuthService} from "./services/AdminAuthService";

export const ADMIN_COMMANDS = ["admin:create", "admin:reset", "config:reset"];

/**
 * @param args Arguments after the command.
 * @param name Flag name without dashes.
 * @returns The flag's value, or undefined.
 */
function flag(args: string[], name: string): string | undefined {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
}

/**
 * Reads a line from the terminal without echoing it (or from a pipe when stdin isn't a terminal).
 * @param question Prompt to show.
 * @returns What was typed.
 */
function askHidden(question: string): Promise<string> {
    return new Promise((resolve) => {
        const rl = readline.createInterface({input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY});
        if (process.stdin.isTTY) {
            // Print the prompt ourselves, then swallow what readline would echo back.
            process.stdout.write(question);
            (rl as unknown as {_writeToOutput: (text: string) => void})._writeToOutput = () => undefined;
        }
        rl.question(process.stdin.isTTY ? "" : question, (answer) => {
            rl.close();
            if (process.stdin.isTTY) {
                process.stdout.write("\n");
            }
            resolve(answer);
        });
    });
}

/**
 * `config:reset`: removes every setting saved in the admin portal, so the environment variables apply
 * again. The same as the console's Danger zone, for when the console can't be used (no email to send the
 * code to, or no admin can sign in). Whoever can run it on the server has that authority already, so it
 * asks for a typed confirmation instead of an emailed code.
 */
async function runConfigReset(args: string[]): Promise<number> {
    await runMigrations(appService.getDatabasePool(), appService.getLogger());
    if (!args.includes("--yes")) {
        const answer = await askHidden("This removes every setting saved in the admin portal; the environment variables apply again.\nType RESET to continue: ");
        if (answer.trim() !== "RESET") {
            console.error("Cancelled.");
            return 1;
        }
    }
    const removed = await appService.getSettings().resetAll();
    console.log(`${removed} saved ${removed === 1 ? "setting was" : "settings were"} removed. Restart the server for the environment variables to apply.`);
    return 0;
}

/**
 * Runs an `admin:*` or `config:*` command.
 * @param command The command name.
 * @param args The arguments after it.
 * @returns The process exit code.
 */
export async function runAdminCli(command: string, args: string[]): Promise<number> {
    if (command === "config:reset") {
        return runConfigReset(args);
    }
    const email = flag(args, "email");
    if (!email) {
        console.error(`Usage: node index.js ${command} --email <address>${command === "admin:create" ? ' [--name "<name>"]' : ""}`);
        return 2;
    }

    await runMigrations(appService.getDatabasePool(), appService.getLogger());
    const auth = new AdminAuthService(appService.getDatabasePool(), appService.getLogger(), appService.getJwtSecret());

    let password = process.env.ADMIN_PASSWORD ?? "";
    if (!password) {
        password = await askHidden("Password (12+ characters, upper and lower case, a number and a symbol): ");
        if (password !== await askHidden("Repeat the password: ")) {
            console.error("The passwords don't match.");
            return 1;
        }
    }

    try {
        if (command === "admin:create") {
            const admin = await auth.create({email, name: flag(args, "name") ?? email.split("@")[0], password, role: "superadmin"});
            console.log(`Admin ${admin.email} created. They set up two-factor authentication at their first login.`);
        } else {
            const existing = (await auth.list()).find((admin) => admin.email.toLowerCase() === email.toLowerCase());
            if (!existing) {
                console.error(`No admin with the email ${email}. Use admin:create.`);
                return 1;
            }
            await auth.createOrReset({email, name: existing.name, password});
            console.log(`Password of ${email} changed and two-factor removed. They set it up again at their next login.`);
        }
    } catch (error) {
        if (error instanceof ValidationError || error instanceof ConflictError) {
            console.error(error.message + (error instanceof ConflictError ? " Use admin:reset to change its password." : ""));
            return 1;
        }
        throw error;
    }

    if (!appService.isAdminEnabled()) {
        console.log("Note: the portal is switched off. Set ADMIN_ENABLED=true and restart the server to use it.");
    }
    return 0;
}
