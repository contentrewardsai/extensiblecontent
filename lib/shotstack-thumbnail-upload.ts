import { describeFallback } from "@/lib/storage-destination";
import { performStorageUpload } from "@/lib/storage-upload";
import { getServiceSupabase } from "@/lib/supabase-service";

const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024; // 2 MB safety cap
const ALLOWED_CONTENT_TYPES = ["image/png", "image/webp", "image/jpeg"] as const;

export type ThumbnailUploadResult =
	| {
			ok: true;
			thumbnailUrl: string;
			thumbnailUpdatedAt: string;
			storageType: "supabase" | "ghl";
			fallbackMessage: string | null;
	  }
	| { ok: false; status: number; error: string };

/**
 * Upload a captured Fabric-canvas thumbnail and stamp
 * `thumbnail_url` / `thumbnail_updated_at` / `thumbnail_storage_type` on the
 * template row. Thumbnails follow the same storage-destination resolver as
 * renders: HighLevel Media Library when configured, otherwise the public
 * post-media bucket.
 */
export async function uploadTemplateThumbnail(params: {
	internalUserId: string;
	templateId: string;
	contentType: string;
	bytes: ArrayBuffer;
	/**
	 * Optional GHL context from the calling surface. When the caller is inside
	 * a GHL Custom Page, pass the active locationId/companyId so the resolver
	 * can pick that location's Media Library without relying on the user's
	 * saved default.
	 */
	activeGhlContext?: { locationId?: string | null; companyId?: string | null } | null;
}): Promise<ThumbnailUploadResult> {
	const { internalUserId, templateId, contentType, bytes } = params;
	if (!ALLOWED_CONTENT_TYPES.includes(contentType as (typeof ALLOWED_CONTENT_TYPES)[number])) {
		return { ok: false, status: 400, error: "Unsupported thumbnail content type" };
	}
	if (bytes.byteLength === 0) {
		return { ok: false, status: 400, error: "Thumbnail is empty" };
	}
	if (bytes.byteLength > MAX_THUMBNAIL_BYTES) {
		return { ok: false, status: 413, error: "Thumbnail exceeds 2 MB limit" };
	}

	const supabase = getServiceSupabase();

	// Confirm the caller owns a non-builtin template with this id. We disallow
	// thumbnail writes against built-ins so a GHL-linked viewer can't silently
	// "claim" a starter template by overwriting its thumbnail.
	const { data: existing } = await supabase
		.from("shotstack_templates")
		.select("id, is_builtin")
		.eq("id", templateId)
		.eq("user_id", internalUserId)
		.maybeSingle();
	if (!existing) {
		return { ok: false, status: 404, error: "Template not found" };
	}
	if (existing.is_builtin) {
		return { ok: false, status: 409, error: "Built-in templates cannot have thumbnails" };
	}

	const ext = contentType === "image/webp" ? "webp" : contentType === "image/jpeg" ? "jpg" : "png";
	// Stable Supabase path per template so upserts overwrite. GHL uploads can't
	// be "upserted" like this — each call creates a new media entry — but the
	// template row only stores the latest URL, so older GHL uploads just become
	// unreferenced entries in the user's Media Library.
	const filename = `${templateId}.${ext}`;

	let uploadResult;
	try {
		uploadResult = await performStorageUpload({
			resolve: {
				internalUserId,
				activeGhlContext: params.activeGhlContext ?? null,
			},
			supabasePathPrefix: `${internalUserId}/shotstack-thumbnails`,
			filename,
			contentType,
			bytes,
			privateSupabase: false,
		});
	} catch (err) {
		return { ok: false, status: 500, error: err instanceof Error ? err.message : "Upload failed" };
	}

	const thumbnailUpdatedAt = new Date().toISOString();
	const { error: updateError } = await supabase
		.from("shotstack_templates")
		.update({
			thumbnail_url: uploadResult.fileUrl,
			thumbnail_updated_at: thumbnailUpdatedAt,
			thumbnail_storage_type: uploadResult.storageType,
		})
		.eq("id", templateId)
		.eq("user_id", internalUserId);
	if (updateError) {
		return { ok: false, status: 500, error: updateError.message };
	}

	return {
		ok: true,
		thumbnailUrl: uploadResult.fileUrl,
		thumbnailUpdatedAt,
		storageType: uploadResult.storageType,
		fallbackMessage: uploadResult.fallbackReason
			? `${describeFallback(uploadResult.fallbackReason)}${uploadResult.fallbackDetail ? ` (${uploadResult.fallbackDetail})` : ""}`
			: null,
	};
}

/**
 * Build a cache-busted display URL. Templates that have never been captured
 * return `null` so the gallery can render a placeholder.
 */
export function resolveThumbnailDisplayUrl(row: {
	thumbnail_url?: string | null;
	thumbnail_updated_at?: string | null;
	updated_at?: string | null;
}): string | null {
	if (!row.thumbnail_url) return null;
	const bust = row.thumbnail_updated_at || row.updated_at || "";
	if (!bust) return row.thumbnail_url;
	const sep = row.thumbnail_url.includes("?") ? "&" : "?";
	return `${row.thumbnail_url}${sep}v=${encodeURIComponent(bust)}`;
}
