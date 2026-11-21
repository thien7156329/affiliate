export type ProductCategory =
  | 'tech'
  | 'beauty'
  | 'food'
  | 'fashion'
  | 'fitness'
  | 'toys'
  | 'household'
  | 'baby'
  | 'pets';

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  affiliate_url?: string;
  hashtags?: string[];
  description?: string;
  image_url?: string;
  images?: string[];
  video_url?: string;
  promptsObj?: Record<string, string>;
  scene_images?: string[];
  scene_urls?: string[];
  created_at?: string;
  consensus_feedback?: string;
  debate_messages?: any[];
  part_feedback?: string;
  episodes?: EpisodeDefinition[];
  world_style?: string;
}

export interface EpisodeDefinition {
  id: string;
  title: string;
  startScene: number;
  endScene: number;
}

export interface GeneratedEpisode {
  id: string;
  title: string;
  startScene: number;
  endScene: number;
  filename: string;
  local_path: string;
  video_url: string;
  voiced_path?: string | null;
  voiced_url?: string | null;
  thumbnail_url?: string | null;
}

export interface VideoItem {
  id: string;
  title: string;
  product_name?: string;
  category?: string;
  stream_url?: string;
  s3_url?: string;
  thumbnail_url?: string;
  source_image_url?: string;
  description?: string;
  description_vi?: string;
  caption?: string;
  english_prompt?: string;
  hashtags?: string[];
  tags?: string[];
  status?: string;
  tiktok_status?: string;
  tiktok_video_id?: string;
  images?: string[];
  created_at?: string;
  job_name?: string;
  download_url?: string;
  local_path?: string;
  video_url?: string;
  episodes?: GeneratedEpisode[];
  youtube_video_id?: string;
  youtube_url?: string;
  youtube_shorts_url?: string;
  youtube_published_at?: string;
  fb_video_id?: string;
  fb_post_url?: string;
  fb_reel_url?: string;
  fb_page_id?: string;
  fb_published_at?: string;
  tiktok_published_at?: string;
  is_published?: boolean;
  published_at?: string;
  aspect_ratio?: '9:16' | '16:9';
  video_format?: 'short' | 'long';
  playlist_name?: string;
}

export interface AiDebateMessage {
  agent: string;
  model: string;
  role: string;
  title: string;
  content: string;
  timestamp: string;
  score?: number;
  round?: number;
}

export interface CharacterVoice {
  id: string;
  name: string;
  voice_id: string;
  language?: string;
  gender?: string;
  description?: string;
}

export interface PartInfo {
  index: number;
  partNum: number;
  prompt: string;
  dialogue: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  statusText?: string;
}

export interface PipelineStats {
  total_videos: number;
  tiktok_mode: string;
  is_running?: boolean;
}
