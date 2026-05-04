-- Automated clip production pipeline tables

-- Source videos linked to a project for pipeline processing
CREATE TABLE IF NOT EXISTS public.project_source_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  storage_path text,
  storage_bucket text,
  ghl_media_url text,
  original_filename text NOT NULL DEFAULT '',
  duration_sec double precision,
  stt_status text NOT NULL DEFAULT 'pending'
    CHECK (stt_status IN ('pending', 'processing', 'done', 'failed')),
  stt_result jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
COMMENT ON TABLE public.project_source_videos
  IS 'Source videos linked to a project for automated clip pipeline processing.';

-- Clip processing queue
CREATE TABLE IF NOT EXISTS public.project_clip_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_video_id uuid NOT NULL
    REFERENCES public.project_source_videos(id) ON DELETE CASCADE,
  segment_start_sec double precision NOT NULL DEFAULT 0,
  segment_end_sec double precision NOT NULL DEFAULT 0,
  template_id uuid REFERENCES public.shotstack_templates(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'stt', 'trimming', 'rendering', 'posting', 'done', 'failed')),
  step_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_url text,
  posted_at timestamptz,
  error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
COMMENT ON TABLE public.project_clip_queue
  IS 'Clip processing queue for the automated pipeline. Each row is one clip job.';

-- Pipeline config on projects
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS pipeline_clips_per_day integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pipeline_default_template_ids uuid[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pipeline_posting_target text NOT NULL DEFAULT 'none'
    CHECK (pipeline_posting_target IN ('highlevel', 'uploadpost', 'none')),
  ADD COLUMN IF NOT EXISTS pipeline_auto_run boolean NOT NULL DEFAULT false;

-- RLS (enabled, no policies yet — service role access only)
ALTER TABLE public.project_source_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_clip_queue ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_source_videos_project
  ON public.project_source_videos(project_id);
CREATE INDEX IF NOT EXISTS idx_clip_queue_project_status
  ON public.project_clip_queue(project_id, status);
CREATE INDEX IF NOT EXISTS idx_clip_queue_source_video
  ON public.project_clip_queue(source_video_id);
