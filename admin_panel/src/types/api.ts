export type LLMProvider = 'ollama' | 'gemini' | 'groq' | 'openai';
export type TTSProvider = 'kokoro' | 'piper' | 'cartesia' | 'elevenlabs';

export interface RuntimeProviderConfig {
  provider: LLMProvider;
  model: string;
  base_url: string | null;
}

export interface ProviderOption {
  provider: LLMProvider;
  display_name: string;
  configured: boolean;
  local: boolean;
  default_model: string;
}

export interface ProviderSettingsResponse {
  active: RuntimeProviderConfig;
  providers: ProviderOption[];
  updated_at: string;
}

export interface VoiceProfile {
  voice_id: string;
  name: string;
  provider: TTSProvider;
  gender: 'female' | 'male' | 'neutral';
  accent: string;
  recommended_speed: number;
  description: string;
  role_fit: string[];
}

export interface LatencyBreakdown {
  vad_ms: number;
  stt_ms: number;
  rag_ms: number;
  llm_ms: number;
  tts_ms: number;
  total_ms: number;
  recorded_at: string;
}

export interface ServiceHealth {
  name: string;
  status: 'ready' | 'attention';
  detail: string;
}

export interface DashboardResponse {
  active_provider: RuntimeProviderConfig;
  latest_latency: LatencyBreakdown | null;
  target_latency_ms: number;
  services: ServiceHealth[];
  tool_calls_last_hour: number;
  knowledge_documents: number;
}

export type KnowledgeDocumentScope = 'tenant_wide' | 'persona_specific';
export type KnowledgeDocumentStatus = 'indexed' | 'pending' | 'indexing' | 'failed' | 'deleting';
export type KnowledgeIngestionStatus = 'pending' | 'indexing' | 'indexed' | 'failed' | 'deleting';

export interface KnowledgeDocument {
  id: string;
  name: string;
  tenant_id: string;
  chunks_indexed: number;
  uploaded_at: string;
  status: KnowledgeDocumentStatus;
  is_enabled: boolean;
  scope: KnowledgeDocumentScope;
  assigned_personas: string[];
  version: number;
  ingestion_status: KnowledgeIngestionStatus;
  ingestion_error?: string | null;
}

export interface PersonaVoiceUpdate {
  voice_id: string;
  provider?: TTSProvider;
  speed?: number;
  pitch?: number;
}

export interface PersonaVoiceUpdateResponse {
  persona_key: string;
  voice_id: string;
  provider: TTSProvider;
  gender: 'female' | 'male' | 'neutral';
  accent: string;
  recommended_speed: number;
  description: string;
  role_fit: string[];
}

export interface PersonaOption {
  key: string;
  name: string;
}

export type GroundingMode = 'knowledge_strict' | 'prompt_only' | 'hybrid_balanced' | 'knowledge_first';

export interface PersonaKnowledgeSettings {
  tenant_id: string;
  persona_key: string;
  grounding_mode: GroundingMode;
  min_relevance_score: number;
  max_chunks_per_turn: number;
  custom_fallback_spoken: string | null;
  updated_at: string | null;
}

export interface KnowledgeSearchChunk {
  source: string;
  excerpt: string;
  score: number;
}

export interface KnowledgeSearchResult {
  has_context: boolean;
  chunks: KnowledgeSearchChunk[];
  fallback_spoken: string | null;
}
