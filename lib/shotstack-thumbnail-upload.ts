import { getServiceSupabase } from "@/lib/supabase-service";
import { POST_MEDIA_BUCKET_PUBLIC } from "@/lib/storage-post-media";

const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024; // 2 MB safety cap
const ALLOWED_CONTENT_TYPES = ["image/png", "image/webp", "image/jpeg"] as const;

export type ThumbnailUploadResult =
	| { ok: true; thumbnailUrl: string; thumbnailUpdatedAt: string }
	| { ok: false; status: number; error: string };

/**
 * Upload a captured Fabric-canvas thumbnail to the public post-media bucket and
 * stamp `thumbnail_url` / `thumbnail_updated_at` on the template row.
 *
 * Ownership check: the caller must be the template's `user_id`. Built-in
 * templates (user_id IS NULL, is_builtin TRUE) cannot receive thumbnails
 * through this path — the clone-on-save flow captures a thumbnail for the
 * resulting copy instead.
 *
 * Path layout: `${owner}/shotstack-thumbnails/${templateId}.png` (upsert).
 * Using a stable path per template means each save overwrites the previous
 * thumbnail with no orphan cleanup needed; cache-busting is handled client
 * side by appending `?v=${thumbnailUpdatedAt}` when the URL is rendered.
 */
export async function uploadTemplateThumbnail(params: {
	internalUserId: string;
	templateId: string;
	contentType: string;
	bytes: ArrayBuffer;
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
	const filePath = `${internalUserId}/shotstack-thumbnails/${templateId}.${ext}`;
	const { error: uploadError } = await supabase.storage.from(POST_MEDIA_BUCKET_PUBLIC).upload(filePath, bytes, {
		contentType,
		upsert: true,
	});
	if (uploadError) {
		return { ok: false, status: 500, error: uploadError.message };
	}

	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
	if (!supabaseUrl) {
		return { ok: false, status: 500, error: "NEXT_PUBLIC_SUPABASE_URL is not set" };
	}
	const publicUrl = `${supabaseUrl}/storage/v1/object/public/${POST_MEDIA_BUCKET_PUBLIC}/${filePath}`;
	const thumbnailUpdatedAt = new Date().toISOString();
	const { error: updateError } = await supabase
		.from("shotstack_templates")
		.update({ thumbnail_url: publicUrl, thumbnail_updated_at: thumbnailUpdatedAt })
		.eq("id", templateId)
		.eq("user_id", internalUserId);
	if (updateError) {
		return { ok: false, status: 500, error: updateError.message };
	}

	return { ok: true, thumbnailUrl: publicUrl, thumbnailUpdatedAt };
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
