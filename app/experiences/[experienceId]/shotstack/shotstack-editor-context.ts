/**
 * ShotstackEditorContext decouples the editor host/browser-render UI from the
 * auth flow of the page that mounts them. The same `ShotstackEditorHost` and
 * `BrowserRenderButton` components are used from:
 *
 *   - Whop experience pages (`/experiences/.../shotstack/editor/[id]`) — auth
 *     via Whop user token / cookie, context is an `experienceId`.
 *   - GHL Custom Page (`/ext/shotstack/editor/[id]`) — auth via the signed
 *     `ec_whop_user` cookie, context is `locationId` / `companyId`.
 *
 * We pass an explicit context object so each surface can wire its own API
 * endpoints, form fields, and post-clone navigation URLs without branching
 * inside the shared components.
 */
export interface ShotstackEditorContext {
	/**
	 * Full URL prefix for template CRUD. The component appends
	 * `/${templateId}`, `/${templateId}/clone`, etc.
	 * e.g. `/api/whop/shotstack-templates` or `/api/ghl/shotstack-templates`.
	 */
	templatesApiBase: string;
	/** Query string (without leading `?`) appended to every templates API call. */
	templatesApiQuery: string;
	/** Full URL of the browser-render endpoint. */
	browserRenderUrl: string;
	/**
	 * Extra form fields appended to each browser-render upload so the server
	 * can re-verify the caller (e.g. `{ experienceId }` on Whop or
	 * `{ locationId, companyId }` on GHL).
	 */
	browserRenderFields: Record<string, string>;
	/**
	 * URL prefix for the editor page itself (without trailing slash). Used to
	 * navigate to the newly cloned template after an implicit clone-on-save.
	 * e.g. `/experiences/${eid}/shotstack/editor` or `/ext/shotstack/editor`.
	 */
	editorUrlPrefix: string;
	/** URL of the "← Back to templates" link. */
	backUrl: string;
	/**
	 * Optional: full URL of the thumbnail-upload endpoint. When set the host
	 * captures a PNG thumbnail from the Fabric canvas after each save and
	 * POSTs it. The same `browserRenderFields` are appended so the server can
	 * re-verify the caller.
	 */
	thumbnailUploadUrl?: string;
	/**
	 * Optional: full URL of the image-upload endpoint used by the visual
	 * editor to persist user-added images to Supabase storage. When set, the
	 * host intercepts `addImage` calls and replaces data-URL sources with
	 * persistent HTTP URLs so the template JSON stays compact and the images
	 * work in both Pixi.js browser renders and ShotStack cloud renders.
	 *
	 * The same `browserRenderFields` are appended so the server can
	 * re-verify the caller.
	 */
	imageUploadUrl?: string;
	/**
	 * Optional: full URL of the video-upload endpoint used by the visual
	 * editor to persist preprocessed video clips. When set, the editor
	 * uploads processed clips (trimmed, scaled, format-normalized) so they
	 * survive browser restarts. Falls back to HighLevel → Supabase.
	 *
	 * The same `browserRenderFields` are appended so the server can
	 * re-verify the caller.
	 */
	videoUploadUrl?: string;
}
