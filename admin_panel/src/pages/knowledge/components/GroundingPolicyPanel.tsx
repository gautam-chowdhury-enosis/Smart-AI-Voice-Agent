import type { Dispatch, SetStateAction } from 'react';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import type { GroundingMode } from '../../../types/api';

export interface GroundingPolicyDraft {
  grounding_mode: GroundingMode;
  min_relevance_score: number;
  max_chunks_per_turn: number;
  custom_fallback_spoken: string;
}

export interface PersonaOption {
  key: string;
  name: string;
}

export interface GroundingPolicyPanelProps {
  activePersonaKey: string;
  policyDraft: GroundingPolicyDraft;
  onChangePolicy: Dispatch<SetStateAction<GroundingPolicyDraft>>;
  onSavePolicy: () => void;
  isSaving: boolean;
  isLoading?: boolean;
  personaOptions: readonly PersonaOption[];
}

const POLICY_OPTIONS: readonly { value: GroundingMode; label: string }[] = [
  { value: 'knowledge_strict', label: 'Strict Knowledge Only' },
  { value: 'prompt_only', label: 'Prompt Only (No RAG)' },
  { value: 'hybrid_balanced', label: 'Hybrid Balanced' },
  { value: 'knowledge_first', label: 'Knowledge First' },
];

/** Persona-specific grounding and retrieval safety configuration panel. */
export function GroundingPolicyPanel({
  activePersonaKey,
  policyDraft,
  onChangePolicy,
  onSavePolicy,
  isSaving,
  isLoading = false,
  personaOptions,
}: GroundingPolicyPanelProps) {
  const activePersonaName =
    personaOptions.find((option) => option.key === activePersonaKey)?.name ?? 'Elena';

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="section-title text-lg">Grounding policy</h3>
          <p className="section-copy">Persona-specific retrieval behavior</p>
        </div>
        <Badge tone="accent">{activePersonaName}</Badge>
      </div>

      <div className="mt-4 space-y-4">
        <div className="space-y-2">
          {POLICY_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-2.5 text-sm text-slate-200"
            >
              <input
                type="radio"
                name="grounding-mode"
                checked={policyDraft.grounding_mode === option.value}
                onChange={() =>
                  onChangePolicy((current) => ({
                    ...current,
                    grounding_mode: option.value,
                  }))
                }
                className="h-4 w-4 border-slate-600 bg-slate-900 text-indigo-500"
              />
              {option.label}
            </label>
          ))}
        </div>

        <label className="block">
          <span className="field-label">Minimum relevance threshold</span>
          <div className="mt-2 flex items-center gap-3">
            <input
              type="range"
              min={0.5}
              max={0.9}
              step={0.05}
              value={policyDraft.min_relevance_score}
              aria-label="Minimum relevance score threshold"
              aria-valuetext={`${(policyDraft.min_relevance_score * 100).toFixed(0)} percent`}
              onChange={(event) =>
                onChangePolicy((current) => ({
                  ...current,
                  min_relevance_score: Number(event.target.value),
                }))
              }
              className="h-2 w-full accent-indigo-500"
            />
            <span className="min-w-12 text-right text-xs font-medium text-slate-300">
              {policyDraft.min_relevance_score.toFixed(2)}
            </span>
          </div>
        </label>

        <label className="block">
          <span className="field-label">Max chunks per turn</span>
          <select
            value={policyDraft.max_chunks_per_turn}
            aria-label="Max chunks per turn"
            onChange={(event) =>
              onChangePolicy((current) => ({
                ...current,
                max_chunks_per_turn: Number(event.target.value),
              }))
            }
            className="field mt-2"
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
            <option value={5}>5</option>
          </select>
        </label>

        <label className="block">
          <span className="field-label">Custom spoken fallback</span>
          <textarea
            value={policyDraft.custom_fallback_spoken}
            aria-label="Custom spoken fallback message"
            onChange={(event) =>
              onChangePolicy((current) => ({
                ...current,
                custom_fallback_spoken: event.target.value,
              }))
            }
            rows={3}
            className="field mt-2 resize-none"
            placeholder="Override the default fallback spoken message for this persona."
          />
        </label>

        <Button onClick={onSavePolicy} disabled={isLoading || isSaving}>
          {isSaving ? 'Saving…' : 'Save policy'}
        </Button>
      </div>
    </div>
  );
}
