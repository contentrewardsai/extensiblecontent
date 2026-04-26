-- Client-side (browser) renders store env = 'browser' with zero credits. No change to
-- the column type; values include legacy 'v1', 'stage', and 'browser'.
comment on column public.shotstack_renders.env is
  'Render environment: v1 and stage are ShotStack API; browser is a local MediaRecorder+FFmpeg.wasm path (no API credits).';
