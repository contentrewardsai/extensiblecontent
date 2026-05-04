import type { ElevenLabsModel, Voice } from "./tts-types";

export const TTS_PROVIDERS = [
  { id: "kokoro" as const, label: "Kokoro (Free)", description: "High-quality browser-based TTS — no API key needed" },
  { id: "elevenlabs" as const, label: "ElevenLabs", description: "Premium AI voices" },
];

export const FALLBACK_MODELS: ElevenLabsModel[] = [
  { model_id: "eleven_v3", name: "Eleven v3", description: "Latest ElevenLabs model", can_do_text_to_speech: true, languages: [] },
];

/** Kokoro-82M built-in voices. These run entirely in-browser via WASM. */
export const KOKORO_VOICES: Voice[] = [
  { id: "af_heart", name: "Heart", gender: "female", language: "en-US" },
  { id: "af_bella", name: "Bella", gender: "female", language: "en-US" },
  { id: "af_nicole", name: "Nicole", gender: "female", language: "en-US" },
  { id: "af_sarah", name: "Sarah", gender: "female", language: "en-US" },
  { id: "af_sky", name: "Sky", gender: "female", language: "en-US" },
  { id: "am_adam", name: "Adam", gender: "male", language: "en-US" },
  { id: "am_michael", name: "Michael", gender: "male", language: "en-US" },
  { id: "bf_emma", name: "Emma", gender: "female", language: "en-GB" },
  { id: "bf_isabella", name: "Isabella", gender: "female", language: "en-GB" },
  { id: "bm_george", name: "George", gender: "male", language: "en-GB" },
  { id: "bm_lewis", name: "Lewis", gender: "male", language: "en-GB" },
];

export const ENHANCE_SYSTEM_PROMPT = `You are a professional voice director transforming text into expressive, emotionally rich scripts for ElevenLabs v3 TTS. Your goal is to turn narration into performance.

Analyze the input for speaker intent, emotional arc, subtext, physical state, relationship dynamics, pacing needs, and environmental context.

Use the 4-Layer System: Delivery (HOW), Tone (emotional color), Texture (voice quality), Subtext (what's beneath). Layer 1-3 tags per emotional beat.

Available tags include: [authoritatively], [hesitantly], [breathlessly], [whispered], [softly], [sighs], [chuckles], [laughs], [sobs], [gasps], [pause:200ms], and many more.

Rules: Do not alter original text. Do not over-tag. Do not use conflicting tags. Output ONLY enhanced text with tags, no explanations.`;
