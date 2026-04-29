import { POST_MEDIA_BUCKET_PUBLIC } from "@/lib/storage-post-media";
import { getOwnerStorageStats } from "@/lib/project-quota";
import { getServiceSupabase } from "@/lib/supabase-service";

const ALLOWED_IMAGE_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
	"image/svg+xml",
]);

export type ImageUploadResult =
	| {
			ok: true;
			url: string;
			availableBytes: number;
	  }
	| { ok: false; status: number; error: string };

/**
 * Upload a template editor image to the public Supabase bucket.
 *
 * Storage destination is **always Supabase** (not GHL Media Library) so
 * template images sync reliably across Whop, HighLevel, and the local
 * extension. The user's overall storage quota (`users.max_storage_bytes`)
 * is enforced — there is no per-file size limit; only the remaining pool.
 */
export async function uploadTemplateImage(params: {
	internalUserId: string;
	contentType: string;
	filename: string;
	bytes: ArrayBuffer;
}): Promise<ImageUploadResult> {
	const { internalUserId, contentType, filename, bytes } = params;

	if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
		return {
			ok: false,
			status: 400,
			error: `Unsupported image type: ${contentType}. Allowed: ${[...ALLOWED_IMAGE_TYPES].join(", ")}`,
		};
	}
	if (bytes.byteLength === 0) {
		return { ok: false, status: 400, error: "File is empty" };
	}

	const supabase = getServiceSupabase();

	// Check the user's remaining storage quota.
	const stats = await getOwnerStorageStats(supabase, internalUserId);
	if (bytes.byteLength > stats.availableBytes) {
		return {
			ok: false,
			status: 413,
			error: `Not enough storage. Need ${formatBytes(bytes.byteLength)} but only ${formatBytes(stats.availableBytes)} available of ${formatBytes(stats.maxBytes)} total.`,
		};
	}

	// Build a stable-ish path: {userId}/template-images/{timestamp}-{sanitisedFilename}
	const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
	const filePath = `${internalUserId}/template-images/${Date.now()}-${safe}`;

	const { error: uploadError } = await supabase.storage
		.from(POST_MEDIA_BUCKET_PUBLIC)
		.upload(filePath, bytes, { contentType, upsert: false });
	if (uploadError) {
		return { ok: false, status: 500, error: uploadError.message };
	}

	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
	const url = `${supabaseUrl}/storage/v1/object/public/${POST_MEDIA_BUCKET_PUBLIC}/${filePath}`;

	return {
		ok: true,
		url,
		availableBytes: Math.max(0, stats.availableBytes - bytes.byteLength),
	};
}

function formatBytes(n: number): string {
	if (n <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	let value = n;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value < 10 ? value.toFixed(2) : value < 100 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
