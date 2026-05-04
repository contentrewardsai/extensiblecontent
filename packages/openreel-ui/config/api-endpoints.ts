/**
 * Stub for OpenReel's API endpoints config. We don't use their backend
 * services — our services go through the MediaEditorContext instead.
 */
export const API_BASE_URL = "";
export const OPENREEL_TTS_URL = "";
export const OPENREEL_CLOUD_URL = "";
export const API_ENDPOINTS = {
	kieai: { generate: "/api/stub", status: "/api/stub" },
	tts: { generate: "/api/stub" },
} as const;
export default API_ENDPOINTS;
