import {api} from "@/plugins/api";

/**
 * The `imports` resource client from `@vaultisse/api-client`, bound to this app's
 * axios instance (see `plugins/api.ts`). Kept as a module-level singleton so
 * controllers and models import it the same way as before the HTTP layer
 * moved into the shared package.
 */
export const importService = api.imports;
