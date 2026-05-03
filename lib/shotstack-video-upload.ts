import { POST_MEDIA_BUCKET_PUBLIC } from "@/lib/storage-post-media";
import { getOwnerStorageStats } from "@/lib/project-quota";
import { getServiceSupabase } from "@/lib/supabase-service";
import { uploadToGhlMediaLibrary } from "@/lib/ghl-media-upload";

const ALLOWED_VIDEO_TYPES = new Set([
	"video/mp4",
	"video/webm",
	"video/quicktime",
	"video/x-matroska",
	"video/x-msvideo",
]);

export type VideoUploadResult =
	| {
			ok: true;
			url: string;
			availableBytes: number;
	  }
	| { ok: false; status: number; error: string };

/**
 * Upload a preprocessed video clip to persistent storage.
 *
 * Priority:
 *   1. Try HighLevel Media Library (if locationId provided)
 *   2. Fall back to Supabase public bucket
 *
 * The user's overall storage quota is enforced for the Supabase path.
 */
export async function uploadTemplateVideo(params: {
	internalUserId: string;
	contentType: string;
	filename: string;
	bytes: ArrayBuffer;
	/** Optional: GHL locationId for HighLevel Media Library upload */
	locationId?: string;
	/** Optional: GHL companyId for HighLevel Media Library upload */
	companyId?: string;
}): Promise<VideoUploadResult> {
	const { internalUserId, contentType, filename, bytes, locationId, companyId } = params;

	if (!ALLOWED_VIDEO_TYPES.has(contentType) && !contentType.startsWith("video/")) {
		return {
			ok: false,
			status: 400,
			error: `Unsupported video type: ${contentType}. Allowed: ${[...ALLOWED_VIDEO_TYPES].join(", ")}`,
		};
	}
	if (bytes.byteLength === 0) {
		return { ok: false, status: 400, error: "File is empty" };
	}

	/* ── Try HighLevel Media Library first ── */
	if (locationId) {
		try {
			const ghlResult = await uploadToGhlMediaLibrary({
				internalUserId,
				locationId,
				filename,
				contentType,
				bytes,
			});
			if (ghlResult && ghlResult.url) {
				return { ok: true, url: ghlResult.url, availableBytes: -1 };
			}
		} catch (e) {
			console.warn("[video-upload] GHL upload failed, falling back to Supabase:", e);
		}
	}

	/* ── Fall back to Supabase ── */
	const supabase = getServiceSupabase();

	const stats = await getOwnerStorageStats(supabase, internalUserId);
	if (bytes.byteLength > stats.availableBytes) {
		return {
			ok: false,
			status: 413,
			error: `Not enough storage. Need ${formatBytes(bytes.byteLength)} but only ${formatBytes(stats.availableBytes)} available.`,
		};
	}

	const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
	const filePath = `${internalUserId}/processed-clips/${Date.now()}-${safe}`;

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
