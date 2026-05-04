/**
 * MediaEditorContext decouples the editor host/export UI from the auth flow of
 * the page that mounts them. The same editor components are used from:
 *
 *   - Whop experience pages (`/experiences/.../media/editor/[id]`) — auth via
 *     Whop user token / cookie, context is an `experienceId`.
 *   - GHL Custom Page (`/ext/media/editor/[id]`) — auth via the signed
 *     `ec_whop_user` cookie, context is `locationId` / `companyId`.
 *
 * We pass an explicit context object so each surface can wire its own API
 * endpoints, form fields, and post-clone navigation URLs without branching
 * inside the shared components.
 */
export interface MediaEditorContext {
	/** Full URL prefix for template CRUD (e.g. `/api/whop/shotstack-templates`). */
	templatesApiBase: string;
	/** Query string (without leading `?`) appended to every templates API call. */
	templatesApiQuery: string;
	/** Full URL of the browser-render endpoint. */
	browserRenderUrl: string;
	/** Extra form fields appended to each render upload for re-verification. */
	browserRenderFields: Record<string, string>;
	/** URL prefix for the editor page (e.g. `/experiences/${eid}/media/editor`). */
	editorUrlPrefix: string;
	/** URL of the "Back to templates" link. */
	backUrl: string;
	thumbnailUploadUrl?: string;
	imageUploadUrl?: string;
	videoUploadUrl?: string;
	presignedUploadUrl?: string;
	confirmUploadUrl?: string;
}
