import type { ElevenLabsModel, Voice } from "./tts-types";

export const TTS_PROVIDERS = [
  { id: "kokoro" as const, label: "Kokoro (Free)", description: "High-quality browser-based TTS — no API key needed" },
  { id: "elevenlabs" as const, label: "ElevenLabs", description: "Premium AI voices" },
];

export const FALLBACK_MODELS: ElevenLabsModel[] = [
  { model_id: "eleven_v3", name: "Eleven v3", description: "Latest ElevenLabs model", can_do_text_to_speech: true, languages: [] },
];

export interface KokoroLanguage {
  code: string;
  label: string;
  flag: string;
}

export const KOKORO_LANGUAGES: KokoroLanguage[] = [
  { code: "en-US", label: "American English", flag: "🇺🇸" },
  { code: "en-GB", label: "British English", flag: "🇬🇧" },
  { code: "ja",    label: "Japanese",        flag: "🇯🇵" },
  { code: "zh",    label: "Chinese",         flag: "🇨🇳" },
  { code: "es",    label: "Spanish",         flag: "🇪🇸" },
  { code: "fr",    label: "French",          flag: "🇫🇷" },
  { code: "hi",    label: "Hindi",           flag: "🇮🇳" },
  { code: "it",    label: "Italian",         flag: "🇮🇹" },
  { code: "pt",    label: "Portuguese",      flag: "🇧🇷" },
];

/** Kokoro-82M built-in voices (54 voices, 8 languages). Run entirely in-browser via WASM. */
export const KOKORO_VOICES: Voice[] = [
  // American English
  { id: "af_heart",   name: "Heart",   gender: "female", language: "en-US" },
  { id: "af_alloy",   name: "Alloy",   gender: "female", language: "en-US" },
  { id: "af_aoede",   name: "Aoede",   gender: "female", language: "en-US" },
  { id: "af_bella",   name: "Bella",   gender: "female", language: "en-US" },
  { id: "af_jessica", name: "Jessica", gender: "female", language: "en-US" },
  { id: "af_kore",    name: "Kore",    gender: "female", language: "en-US" },
  { id: "af_nicole",  name: "Nicole",  gender: "female", language: "en-US" },
  { id: "af_nova",    name: "Nova",    gender: "female", language: "en-US" },
  { id: "af_river",   name: "River",   gender: "female", language: "en-US" },
  { id: "af_sarah",   name: "Sarah",   gender: "female", language: "en-US" },
  { id: "af_sky",     name: "Sky",     gender: "female", language: "en-US" },
  { id: "am_adam",    name: "Adam",    gender: "male",   language: "en-US" },
  { id: "am_echo",    name: "Echo",    gender: "male",   language: "en-US" },
  { id: "am_eric",    name: "Eric",    gender: "male",   language: "en-US" },
  { id: "am_fenrir",  name: "Fenrir",  gender: "male",   language: "en-US" },
  { id: "am_liam",    name: "Liam",    gender: "male",   language: "en-US" },
  { id: "am_michael", name: "Michael", gender: "male",   language: "en-US" },
  { id: "am_onyx",    name: "Onyx",    gender: "male",   language: "en-US" },
  { id: "am_puck",    name: "Puck",    gender: "male",   language: "en-US" },
  { id: "am_santa",   name: "Santa",   gender: "male",   language: "en-US" },
  // British English
  { id: "bf_alice",    name: "Alice",    gender: "female", language: "en-GB" },
  { id: "bf_emma",     name: "Emma",     gender: "female", language: "en-GB" },
  { id: "bf_isabella", name: "Isabella", gender: "female", language: "en-GB" },
  { id: "bf_lily",     name: "Lily",     gender: "female", language: "en-GB" },
  { id: "bm_daniel",   name: "Daniel",   gender: "male",   language: "en-GB" },
  { id: "bm_fable",    name: "Fable",    gender: "male",   language: "en-GB" },
  { id: "bm_george",   name: "George",   gender: "male",   language: "en-GB" },
  { id: "bm_lewis",    name: "Lewis",    gender: "male",   language: "en-GB" },
  // Japanese
  { id: "jf_alpha",      name: "Alpha",      gender: "female", language: "ja" },
  { id: "jf_gongitsune", name: "Gongitsune", gender: "female", language: "ja" },
  { id: "jf_nezumi",     name: "Nezumi",     gender: "female", language: "ja" },
  { id: "jf_tebukuro",   name: "Tebukuro",   gender: "female", language: "ja" },
  { id: "jm_kumo",       name: "Kumo",       gender: "male",   language: "ja" },
  // Chinese
  { id: "zf_xiaobei",  name: "Xiaobei",  gender: "female", language: "zh" },
  { id: "zf_xiaoni",   name: "Xiaoni",   gender: "female", language: "zh" },
  { id: "zf_xiaoxiao", name: "Xiaoxiao", gender: "female", language: "zh" },
  { id: "zf_xiaoyi",   name: "Xiaoyi",   gender: "female", language: "zh" },
  { id: "zm_yunjian",  name: "Yunjian",  gender: "male",   language: "zh" },
  { id: "zm_yunxi",    name: "Yunxi",    gender: "male",   language: "zh" },
  { id: "zm_yunxia",   name: "Yunxia",   gender: "male",   language: "zh" },
  { id: "zm_yunyang",  name: "Yunyang",  gender: "male",   language: "zh" },
  // Spanish
  { id: "ef_dora",   name: "Dora",  gender: "female", language: "es" },
  { id: "em_alex",   name: "Alex",  gender: "male",   language: "es" },
  { id: "em_santa",  name: "Santa", gender: "male",   language: "es" },
  // French
  { id: "ff_siwis", name: "Siwis", gender: "female", language: "fr" },
  // Hindi
  { id: "hf_alpha", name: "Alpha", gender: "female", language: "hi" },
  { id: "hf_beta",  name: "Beta",  gender: "female", language: "hi" },
  { id: "hm_omega", name: "Omega", gender: "male",   language: "hi" },
  { id: "hm_psi",   name: "Psi",   gender: "male",   language: "hi" },
  // Italian
  { id: "if_sara",   name: "Sara",   gender: "female", language: "it" },
  { id: "im_nicola", name: "Nicola", gender: "male",   language: "it" },
  // Portuguese
  { id: "pf_dora",  name: "Dora",  gender: "female", language: "pt" },
  { id: "pm_alex",  name: "Alex",  gender: "male",   language: "pt" },
  { id: "pm_santa", name: "Santa", gender: "male",   language: "pt" },
];

export const ENHANCE_SYSTEM_PROMPT = `You are a professional voice director transforming text into expressive, emotionally rich scripts for ElevenLabs v3 TTS. Your goal is to turn narration into performance.

Analyze the input for speaker intent, emotional arc, subtext, physical state, relationship dynamics, pacing needs, and environmental context.

Use the 4-Layer System: Delivery (HOW), Tone (emotional color), Texture (voice quality), Subtext (what's beneath). Layer 1-3 tags per emotional beat.

Available tags include: [authoritatively], [hesitantly], [breathlessly], [whispered], [softly], [sighs], [chuckles], [laughs], [sobs], [gasps], [pause:200ms], and many more.

Rules: Do not alter original text. Do not over-tag. Do not use conflicting tags. Output ONLY enhanced text with tags, no explanations.`;
