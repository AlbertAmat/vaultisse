/**
 * =============================================================================
 * VaultRoute
 * =============================================================================
 * Mounted at `/api/rest/vault`. CRUD for the caller's vaults, plus membership
 * management (invite links, join requests, role/status changes, removal) and
 * switching which vault is "active" for the caller. All routes require auth;
 * every vault-scoped route additionally checks the caller's membership/role
 * in VaultService - see VaultController/VaultService/VaultRepository for the
 * actual request handling, business rules, and SQL respectively.
 */
import {Router} from 'express';
import {appService} from "../AppService";
import {requireAuth} from "../middlewares/AuthMiddleware";
import {VaultController} from "../controllers/VaultController";
import {lazy} from "./lazySingleton";

const router = Router();
const getVaultController = lazy(() => new VaultController(appService.getDatabasePool()));

/**
 * GET /vault
 * -----------
 * Lists the caller's accepted vaults.
 *
 * Auth: required.
 *
 * Example response (200): [{ "id": 1, "name": "Jane's library", "description": null }]
 */
router.get('', requireAuth, (req, res) => getVaultController().vaults(req, res));

/**
 * GET /vault/roles
 * -----------------
 * Lists the fixed role definitions (readonly/borrower/normal/admin) and their permissions, for a role picker.
 *
 * Auth: required.
 *
 * Example response (200):
 *  [{ "code": 1, "name": "admin", "rank": 3, "can_borrow": true, "can_edit_catalog": true,
 *     "can_manage_members": true, "can_manage_settings": true }, ...]
 */
router.get('/roles', requireAuth, (req, res) => getVaultController().roles(req, res));

/**
 * GET /vault/invite/:uuid
 * -------------------------
 * Previews a vault reachable by its invitation link, before the caller decides to request to join.
 *
 * Auth: required.
 *
 * Example response (200): { "id": 1, "name": "Jane's library", "description": null }
 * Responses: 200 success | 404 { "error": "Invitation not found" }.
 */
router.get('/invite/:uuid', requireAuth, (req, res) => getVaultController().previewInvite(req, res));

/**
 * POST /vault/join/:uuid
 * ------------------------
 * Requests to join a vault via its invitation link. Enrolls the caller at the least-privileged role
 * with a PENDING status - a member with `can_manage_members` must approve it (see PUT /vault/:id/members/:userId).
 *
 * Auth: required.
 *
 * Example response (200): { "id": 1, "name": "Jane's library", "description": null }
 * Responses: 200 success | 404 { "error": "Invitation not found" } | 409 { "error": "Already a member of this vault" }.
 */
router.post('/join/:uuid', requireAuth, (req, res) => getVaultController().join(req, res));

/**
 * GET /vault/:id
 * ---------------
 * Gets one vault's full detail: settings, every member, and the role definitions.
 *
 * Auth: required. Caller must be an accepted member.
 *
 * Example response (200):
 *  { "id": 1, "name": "Jane's library", "description": null, "invitationUuid": "...", "leasingEnabled": false,
 *    "dateCreated": "...", "users": [...], "roles": [...] }
 * Responses: 200 success | 404 { "error": "Vault not found" }.
 */
router.get('/:id', requireAuth, (req, res) => getVaultController().get(req, res));

/**
 * POST /vault
 * ------------
 * Creates a new vault. The caller becomes its first member, with the admin role and ACCEPTED status.
 *
 * Auth: required. Body: { "name": "Jane's library", "description": "Optional description" }
 *
 * Example response (200): { "id": 1, "name": "Jane's library", "description": null }
 * Responses: 200 success | 400 { "error": "Vault name is required" }.
 */
router.post('', requireAuth, (req, res) => getVaultController().create(req, res));

/**
 * PUT /vault/:id
 * ---------------
 * Updates a vault's name/description/leasing preference.
 *
 * Auth: required. Caller must have `can_manage_settings` (admin role). Body: { "name": "New name",
 * "description": "New description", "leasingEnabled": true }
 *
 * Example response (200): { "id": 1, "name": "New name", "description": "New description" }
 * Responses: 200 success | 400 { "error": "Vault name is required" } | 403 { "error": "..." } | 404 { "error": "Vault not found" }.
 */
router.put('/:id', requireAuth, (req, res) => getVaultController().update(req, res));

/**
 * DELETE /vault/:id
 * ------------------
 * Deletes a vault. Refused if the caller has no other vault to fall back to. If it still owns any
 * content (books, customers, locations, ...), it's also refused unless `transferToVaultId` names
 * another vault the caller belongs to - that content is merged into it first (same-named
 * categories/authors/customer groups are reused rather than duplicated).
 *
 * Auth: required. Caller must have `can_manage_settings` (admin role).
 * Body (optional): { "transferToVaultId": 2 }
 *
 * Example response (200): { "message": "Vault deleted successfully" }
 * Responses: 200 success | 400 { "error": "..." } | 403 { "error": "..." } | 404 { "error": "..." } |
 *            409 { "error": "This is the only vault you belong to - you can't delete it" } |
 *            409 { "error": "Vault still has content and can't be deleted" } (no transferToVaultId given) |
 *            409 { "error": "Both vaults have a book with the same ISBN (...) - resolve the duplicate before merging" }.
 */
router.delete('/:id', requireAuth, (req, res) => getVaultController().remove(req, res));

/**
 * PUT /vault/:id/active
 * -----------------------
 * Sets the vault the caller last worked in (`users.last_used_vault_id`), e.g. the one loaded on next login.
 *
 * Auth: required. Caller must be an accepted member.
 *
 * Example response (200): { "message": "Active vault updated successfully" }
 * Responses: 200 success | 404 { "error": "Vault not found" }.
 */
router.put('/:id/active', requireAuth, (req, res) => getVaultController().setActive(req, res));

/**
 * GET /vault/:id/members
 * ------------------------
 * Lists a vault's members (any status - pending/accepted/rejected).
 *
 * Auth: required. Caller must be an accepted member.
 *
 * Example response (200):
 *  [{ "user_id": 1, "name": "Jane Doe", "role": "admin", "status": 1, "date_created": "..." }]
 * Responses: 200 success | 404 { "error": "Vault not found" }.
 */
router.get('/:id/members', requireAuth, (req, res) => getVaultController().members(req, res));

/**
 * PUT /vault/:id/members/:userId
 * ---------------------------------
 * Updates a member's role and/or approval status. Approving/rejecting a pending join request is just
 * setting `status` here. Rejected as ValidationError if it would leave the vault without an admin.
 *
 * Auth: required. Caller must have `can_manage_members`. Body: { "role": 0, "status": 1 } (either field, or both)
 *
 * Example response (200): { "message": "Member updated successfully" }
 * Responses: 200 success | 400 { "error": "..." } | 403 { "error": "..." } | 404 { "error": "..." }.
 */
router.put('/:id/members/:userId', requireAuth, (req, res) => getVaultController().updateMember(req, res));

/**
 * DELETE /vault/:id/members/:userId
 * -------------------------------------
 * Removes a member from a vault. A caller removing their own id leaves the vault; removing anyone else
 * requires `can_manage_members`. Rejected as ValidationError if it would leave the vault without an admin.
 *
 * Auth: required.
 *
 * Example response (200): { "message": "Member removed successfully" }
 * Responses: 200 success | 400 { "error": "..." } | 403 { "error": "..." } | 404 { "error": "Vault not found" }.
 */
router.delete('/:id/members/:userId', requireAuth, (req, res) => getVaultController().removeMember(req, res));

export default router;
