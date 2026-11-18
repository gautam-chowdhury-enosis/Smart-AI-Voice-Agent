import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Cpu,
  Flame,
  Layers,
  Save,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import {
  usePersonaKnowledgeSettings,
  useUpdatePersonaKnowledgeSettings,
} from '../../../hooks/useAdminApi';
import type { GroundingMode, PersonaOption } from '../../../types/api';

export interface GroundingPolicyDraft {
  grounding_mode: GroundingMode;
  min_relevance_score: number;
  max_chunks_per_turn: number;
  custom_fallback_spoken: string;
}

export interface GroundingPolicyWorkbenchProps {
  personaOptions: readonly PersonaOption[];
  drafts: Record<string, GroundingPolicyDraft>;
  onUpdateDraft: (personaKey: string, patch: Partial<GroundingPolicyDraft>) => void;
}

interface StrategyOption {
  value: GroundingMode;
  title: string;
  badge?: string;
  description: string;
  tradeoff: string;
  icon: typeof ShieldCheck;
}

const STRATEGIES: readonly StrategyOption[] = [
  {
    value: 'hybrid_balanced',
    title: 'Hybrid Balanced',
    badge: 'Recommended',
    description:
      'Blends persona prompt guidelines with verified RAG chunks for natural, human-like responses with grounded hotel facts.',
    tradeoff: 'Optimal balance of voice naturalness, factual accuracy, and conversational speed.',
    icon: Sparkles,
  },
  {
    value: 'knowledge_strict',
    title: 'Strict Knowledge Only',
    badge: 'Zero Hallucination',
    description:
      'Bypasses base model general knowledge; answers exclusively from retrieved chunks. Triggers spoken fallback if no chunks match.',
    tradeoff: 'Guarantees zero hallucinations, but may feel rigid if operational documents lack specific answers.',
    icon: ShieldCheck,
  },
  {
    value: 'knowledge_first',
    title: 'Knowledge First',
    badge: 'Context Priority',
    description:
      'Prioritizes retrieved chunks. Uses base model conversational intelligence only when confidence is borderline.',
    tradeoff: 'High accuracy while maintaining conversational warmth during hospitality calls.',
    icon: BookOpen,
  },
  {
    value: 'prompt_only',
    title: 'Prompt Only (No RAG)',
    badge: 'Lowest Latency',
    description:
      'Completely disables vector search retrieval. Operates solely from the persona system prompt for fast chit-chat.',
    tradeoff: 'Sub-300ms latency, but agent cannot answer specific current hotel facts or amenities.',
    icon: Zap,
  },
];

/**
 * Dedicated grounding policy workbench featuring rich strategy cards,
 * threshold safety zones, and draft preservation across tab switches.
 */
export function GroundingPolicyWorkbench({
  personaOptions,
  drafts,
  onUpdateDraft,
}: GroundingPolicyWorkbenchProps) {
  const [selectedPersonaKey, setSelectedPersonaKey] = useState<string>(
    personaOptions[0]?.key ?? 'hotel_booking_specialist',
  );
  const [savedSuccess, setSavedSuccess] = useState(false);

  const personaSettings = usePersonaKnowledgeSettings(selectedPersonaKey);
  const updateSettings = useUpdatePersonaKnowledgeSettings();

  // Active draft for currently selected persona
  const activeDraft: GroundingPolicyDraft = drafts[selectedPersonaKey] ?? {
    grounding_mode: personaSettings.data?.grounding_mode ?? 'hybrid_balanced',
    min_relevance_score: personaSettings.data?.min_relevance_score ?? 0.65,
    max_chunks_per_turn: personaSettings.data?.max_chunks_per_turn ?? 3,
    custom_fallback_spoken: personaSettings.data?.custom_fallback_spoken ?? '',
  };

  // Sync draft when server data loads if not already edited
  useEffect(() => {
    if (personaSettings.data && !drafts[selectedPersonaKey]) {
      onUpdateDraft(selectedPersonaKey, {
        grounding_mode: personaSettings.data.grounding_mode,
        min_relevance_score: personaSettings.data.min_relevance_score,
        max_chunks_per_turn: personaSettings.data.max_chunks_per_turn,
        custom_fallback_spoken: personaSettings.data.custom_fallback_spoken ?? '',
      });
    }
  }, [personaSettings.data, selectedPersonaKey, drafts, onUpdateDraft]);

  // Reset save notification after 3 seconds
  useEffect(() => {
    if (savedSuccess) {
      const timer = setTimeout(() => setSavedSuccess(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [savedSuccess]);

  const handleSave = () => {
    updateSettings.mutate(
      {
        personaKey: selectedPersonaKey,
        payload: {
          grounding_mode: activeDraft.grounding_mode,
          min_relevance_score: Number(activeDraft.min_relevance_score.toFixed(2)),
          max_chunks_per_turn: activeDraft.max_chunks_per_turn,
          custom_fallback_spoken: activeDraft.custom_fallback_spoken.trim() || null,
        },
      },
      {
        onSuccess: () => {
          setSavedSuccess(true);
        },
      },
    );
  };

  const activePersonaName =
    personaOptions.find((p) => p.key === selectedPersonaKey)?.name ?? 'Elena';

  return (
    <div className="space-y-6">
      {/* Persona Selector Ribbon */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="section-title text-base">Select Persona to Configure</h2>
            <p className="section-copy text-xs">Each autonomous voice persona maintains independent safety and retrieval boundaries.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {personaOptions.map(({ key, name }) => {
              const isSelected = selectedPersonaKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setSelectedPersonaKey(key);
                    setSavedSuccess(false);
                  }}
                  className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition ${
                    isSelected
                      ? 'border-indigo-400/50 bg-indigo-500/20 text-indigo-100 shadow-md shadow-indigo-950/40'
                      : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  <Cpu className="h-3.5 w-3.5" />
                  <span>{name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Main Grounding Policy Controls */}
      <Card className="p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-indigo-400" />
              <h3 className="section-title">Grounding Policy: {activePersonaName}</h3>
            </div>
            <p className="section-copy mt-1">
              Configure how {activePersonaName} balances verified RAG documents versus spoken flexibility.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {savedSuccess && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 animate-in fade-in duration-200">
                <CheckCircle2 className="h-4 w-4" />
                Policy saved
              </span>
            )}
            <Button
              onClick={handleSave}
              disabled={updateSettings.isPending || personaSettings.isPending}
              aria-label={`Save grounding policy for ${activePersonaName}`}
            >
              {updateSettings.isPending ? (
                'Saving…'
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="mt-6 space-y-6">
          {/* Strategy Selection Cards */}
          <div>
            <label className="field-label text-sm">Grounding Strategy</label>
            <p className="section-copy text-xs mt-0.5 mb-3">
              Select how strictly the model adheres to ChromaDB vector knowledge chunks.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {STRATEGIES.map((strategy) => {
                const isSelected = activeDraft.grounding_mode === strategy.value;
                const IconComponent = strategy.icon;

                return (
                  <div
                    key={strategy.value}
                    onClick={() =>
                      onUpdateDraft(selectedPersonaKey, { grounding_mode: strategy.value })
                    }
                    className={`cursor-pointer rounded-2xl border p-4 transition ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-500/[0.08] shadow-lg shadow-indigo-950/30 ring-1 ring-indigo-500/50'
                        : 'border-slate-800 bg-slate-950/40 hover:border-slate-700 hover:bg-slate-900/30'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div
                          className={`rounded-lg p-1.5 ${
                            isSelected
                              ? 'bg-indigo-500/20 text-indigo-300'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          <IconComponent className="h-4 w-4" />
                        </div>
                        <h4 className="text-sm font-semibold text-slate-100">{strategy.title}</h4>
                      </div>
                      {strategy.badge && (
                        <Badge tone={isSelected ? 'accent' : 'neutral'}>{strategy.badge}</Badge>
                      )}
                    </div>
                    <p className="mt-2.5 text-xs leading-5 text-slate-400">
                      {strategy.description}
                    </p>
                    <p className="mt-2 text-[11px] leading-4 text-slate-500 italic">
                      Tradeoff: {strategy.tradeoff}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Relevance Threshold Slider & Safety Zones */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <label htmlFor="threshold-slider" className="field-label text-sm">
                  Minimum Relevance Threshold (Similarity Score)
                </label>
                <p className="section-copy text-xs mt-0.5">
                  Chunks below this cosine similarity score are filtered out before reaching the LLM context.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="accent">
                  {Math.round(activeDraft.min_relevance_score * 100)}% Match
                </Badge>
                <span className="font-mono text-xs font-semibold text-slate-300">
                  {activeDraft.min_relevance_score.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="mt-4">
              <input
                id="threshold-slider"
                type="range"
                min={0.5}
                max={0.9}
                step={0.05}
                value={activeDraft.min_relevance_score}
                aria-label="Minimum relevance threshold score"
                aria-valuetext={`${Math.round(activeDraft.min_relevance_score * 100)} percent`}
                onChange={(e) =>
                  onUpdateDraft(selectedPersonaKey, {
                    min_relevance_score: Number(e.target.value),
                  })
                }
                className="h-2 w-full accent-indigo-500 cursor-pointer"
              />
              <div className="mt-2 flex justify-between text-[11px] font-medium text-slate-500">
                <span>0.50 (Loose / High Recall)</span>
                <span className="text-emerald-400 font-semibold">0.65 – 0.75 (Recommended Zone)</span>
                <span>0.90 (Strict / High Precision)</span>
              </div>
            </div>

            {/* Threshold Zone Guidance */}
            <div className="mt-4 rounded-xl border border-slate-800/80 bg-slate-900/60 p-3 text-xs leading-5">
              {activeDraft.min_relevance_score < 0.65 ? (
                <div className="flex items-start gap-2 text-amber-300">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    <strong>Loose Recall Notice:</strong> Thresholds below 0.65 may inject loosely related chunks, increasing speech latency and token costs.
                  </span>
                </div>
              ) : activeDraft.min_relevance_score > 0.75 ? (
                <div className="flex items-start gap-2 text-indigo-300">
                  <Flame className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    <strong>High Precision Notice:</strong> Thresholds above 0.75 require near-exact phrasing and may trigger the spoken fallback message more frequently.
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-2 text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    <strong>Optimal Hospitality Zone:</strong> Excellent factual grounding with low hallucination risk while tolerating varied guest phrasing.
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Max Chunks & Fallback Textarea */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="max-chunks-select" className="field-label text-sm">
                Max Chunks Per Turn
              </label>
              <p className="section-copy text-xs mt-0.5">
                Maximum number of vector excerpts injected into LLM context window.
              </p>
              <select
                id="max-chunks-select"
                value={activeDraft.max_chunks_per_turn}
                aria-label="Max chunks per turn"
                onChange={(e) =>
                  onUpdateDraft(selectedPersonaKey, {
                    max_chunks_per_turn: Number(e.target.value),
                  })
                }
                className="field mt-2.5"
              >
                <option value={1}>1 Chunk (~150 tokens) — Ultra Low Latency</option>
                <option value={2}>2 Chunks (~300 tokens) — Balanced Voice Speed</option>
                <option value={3}>3 Chunks (~450 tokens) — Standard Comprehensive</option>
                <option value={4}>4 Chunks (~600 tokens) — Detailed Explanations</option>
                <option value={5}>5 Chunks (~750 tokens) — Maximum Context Depth</option>
              </select>
            </div>

            <div>
              <label htmlFor="custom-fallback-textarea" className="field-label text-sm">
                Custom Spoken Fallback
              </label>
              <p className="section-copy text-xs mt-0.5">
                Spoken aloud when no vector chunks meet the relevance threshold.
              </p>
              <textarea
                id="custom-fallback-textarea"
                rows={3}
                value={activeDraft.custom_fallback_spoken}
                aria-label="Custom spoken fallback message"
                placeholder={`Leave blank to use default: "I don't have that information in my verified hotel guide, but I would be happy to connect you with our front desk team."`}
                onChange={(e) =>
                  onUpdateDraft(selectedPersonaKey, {
                    custom_fallback_spoken: e.target.value,
                  })
                }
                className="field mt-2.5 resize-none text-xs"
              />
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
