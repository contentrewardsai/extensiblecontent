# FFmpeg (WASM) for the extension

These files are **committed** so **Load unpacked** works without `npm install` or a build step:

- `ffmpeg.js`, `814.ffmpeg.js` — UMD build from `@ffmpeg/ffmpeg` (worker chunk).
- `ffmpeg-core.js`, `ffmpeg-core.wasm` — UMD build from `@ffmpeg/core`.

After bumping `@ffmpeg/ffmpeg` or `@ffmpeg/core` in `package.json`, refresh from a dev machine with dependencies installed:

```bash
npm ci
npm run vendor:ffmpeg
```

Then commit the updated files under `lib/ffmpeg/`. CI runs `npm run test:ffmpeg-vendor` to ensure all four files exist.
