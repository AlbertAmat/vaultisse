/**
 * Defers constructing a value (typically a `*Controller` needing
 * `appService.getDatabasePool()`) until it's first actually needed.
 *
 * Why this exists: `AppService.ts` imports `routes/Routes.ts` (and therefore
 * every `*Route.ts` file) at its own top, before `export const appService =
 * new AppService();` finishes assigning. So a route file that calls
 * `appService.getDatabasePool()` directly at module-load time (e.g. to build
 * a controller instance next to `const router = Router();`) sees `appService`
 * as `undefined` - by the time the first real HTTP request comes in, that
 * circular-import timing issue is long gone, so wrapping the same
 * construction in `lazy(...)` and calling the returned getter from inside
 * each route handler fixes it with no change to `AppService.ts`'s
 * initialization order. Same "plain function, not a class" treatment as
 * `repositories/withTransaction.ts` - infrastructure plumbing, not a
 * per-resource repository/service/controller/util.
 */
export function lazy<T>(factory: () => T): () => T {
    let instance: T | undefined;
    return () => {
        if (instance === undefined) {
            instance = factory();
        }
        return instance;
    };
}
