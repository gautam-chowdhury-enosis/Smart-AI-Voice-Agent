import { useState, type FormEvent } from 'react';
import { Bot, FileSearch, HelpCircle, Lightbulb, Search, Volume2 } from 'lucide-react';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { useKnowledgeSearch, usePersonaKnowledgeSettings } from '../../../hooks/useAdminApi';
import type { PersonaOption } from '../../../types/api';

const QUICK_TEST_UTTERANCES = [
  'What time are check-in and check-out?',
  'What are the valet parking fees?',
  'Are pets allowed in hotel rooms?',
  'What are the restaurant and breakfast hours?',
  'Is room service available 24/7?',
] as const;

export interface RetrievalPlaygroundProps {
  personaOptions: readonly PersonaOption[];
  onNavigateToDocuments?: () => void;
}

/**
 * Decoupled voice retrieval simulator allowing operators to test query
 * confidence scores and spoken fallback policies per persona without
 * mutating grounding policy editor drafts.
 */
export function RetrievalPlayground({
  personaOptions,
  onNavigateToDocuments,
}: RetrievalPlaygroundProps) {
  const [query, setQuery] = useState('What time are check-in and check-out?');
  const [selectedPersonaKey, setSelectedPersonaKey] = useState<string>('all');
  const search = useKnowledgeSearch();

  // If a specific persona is selected, load its active minimum relevance threshold
  const activePersonaKey =
    selectedPersonaKey === 'all' ? 'hotel_booking_specialist' : selectedPersonaKey;
  const personaSettings = usePersonaKnowledgeSettings(activePersonaKey);
  const minThreshold = personaSettings.data?.min_relevance_score ?? 0.65;

  const activePersonaName =
    selectedPersonaKey === 'all'
      ? 'All knowledge (Unrestricted)'
      : personaOptions.find((p) => p.key === selectedPersonaKey)?.name ?? 'Selected Persona';

  const handleSearch = (event?: FormEvent) => {
    if (event) event.preventDefault();
    if (query.trim().length >= 2) {
      search.mutate({
        query: query.trim(),
        persona_key: selectedPersonaKey === 'all' ? undefined : selectedPersonaKey,
      });
    }
  };

  const handleUtteranceClick = (utterance: string) => {
    setQuery(utterance);
    search.mutate({
      query: utterance,
      persona_key: selectedPersonaKey === 'all' ? undefined : selectedPersonaKey,
    });
  };

  return (
    <div className="space-y-6">
      <Card className="p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <FileSearch className="h-5 w-5 text-indigo-400" />
              <h2 className="section-title">Retrieval Playground</h2>
            </div>
            <p className="section-copy mt-1">
              Simulate live caller questions against persona-scoped vector index chunks before deployment.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Current Threshold:</span>
            <Badge tone="accent">{Math.round(minThreshold * 100)}% match</Badge>
          </div>
        </div>

        <form className="mt-6 space-y-4" onSubmit={handleSearch}>
          <div className="grid gap-4 md:grid-cols-[1fr_260px]">
            <label className="block">
              <span className="field-label">Caller Question / Test Query</span>
              <div className="mt-2 flex gap-2">
                <input
                  className="field flex-1"
                  value={query}
                  minLength={2}
                  maxLength={500}
                  placeholder="e.g. Can I request a late check-out?"
                  onChange={(e) => setQuery(e.target.value)}
                />
                <Button
                  type="submit"
                  disabled={search.isPending || query.trim().length < 2}
                  aria-label="Run retrieval test"
                >
                  {search.isPending ? 'Testing…' : <><Search className="h-4 w-4" />Test</>}
                </Button>
              </div>
            </label>

            <label className="block">
              <span className="field-label">Simulate Voice Persona</span>
              <select
                value={selectedPersonaKey}
                onChange={(e) => setSelectedPersonaKey(e.target.value)}
                className="field mt-2"
                aria-label="Select persona scope for retrieval test"
              >
                <option value="all">All Knowledge (Shared Tenant Scope)</option>
                {personaOptions.map(({ key, name }) => (
                  <option key={key} value={key}>
                    {name} ({key.replace(/_/g, ' ')})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
              <Lightbulb className="h-3.5 w-3.5 text-amber-400" />
              <span>Hospitality Quick-Test Utterances:</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {QUICK_TEST_UTTERANCES.map((utterance) => (
                <button
                  key={utterance}
                  type="button"
                  onClick={() => handleUtteranceClick(utterance)}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1 text-xs text-slate-300 transition hover:border-indigo-500/50 hover:bg-indigo-500/10 hover:text-indigo-200"
                >
                  {utterance}
                </button>
              ))}
            </div>
          </div>
        </form>
      </Card>

      <div aria-live="polite" aria-atomic="true">
        {search.isIdle ? (
          <Card className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
            <Search className="h-8 w-8 text-slate-600" />
            <h3 className="mt-3 text-base font-semibold text-slate-200">Ready to test voice retrieval</h3>
            <p className="mt-1 max-w-md text-sm leading-6 text-slate-400">
              Submit a query above or click any hospitality pill to inspect chunk confidence scores, speech safety gating, and spoken fallbacks.
            </p>
          </Card>
        ) : search.isPending ? (
          <Card className="min-h-72 p-6">
            <div className="space-y-4 animate-pulse">
              <div className="h-6 w-48 rounded-lg bg-slate-800" />
              <div className="h-24 rounded-xl bg-slate-800/60" />
              <div className="h-24 rounded-xl bg-slate-800/60" />
            </div>
          </Card>
        ) : search.isError ? (
          <Card className="border-rose-500/30 bg-rose-500/10 p-5 text-sm text-rose-200">
            <p className="font-semibold text-rose-100">Retrieval test failed</p>
            <p className="mt-1">
              {search.error instanceof Error ? search.error.message : 'An unexpected error occurred while searching knowledge chunks.'}
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-200">Simulating Scope:</span>
                <Badge tone="primary">{activePersonaName}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">
                  {search.data.chunks.length} source chunk{search.data.chunks.length === 1 ? '' : 's'} evaluated
                </span>
              </div>
            </div>

            {!search.data.has_context || search.data.chunks.length === 0 ? (
              <Card className="border-amber-500/30 bg-amber-500/[0.06] p-6">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-300">
                    <Volume2 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge tone="warning">No Matching Context (Below Threshold)</Badge>
                    </div>
                    <h4 className="mt-3 text-sm font-semibold text-amber-100">Caller Spoken Fallback</h4>
                    <p className="mt-1 text-sm leading-6 text-amber-100/80 italic">
                      &ldquo;{search.data.fallback_spoken || "I don't have that information in my verified hotel guide, but I would be happy to connect you with our front desk team."}&rdquo;
                    </p>
                    <p className="mt-3 text-xs text-amber-200/60">
                      The caller will hear this spoken response because no chunks satisfied the {Math.round(minThreshold * 100)}% relevance threshold for this persona.
                    </p>
                    {onNavigateToDocuments && (
                      <button
                        type="button"
                        onClick={onNavigateToDocuments}
                        className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-300 hover:text-indigo-200 underline underline-offset-4"
                      >
                        Assign operational documents in Documents tab &rarr;
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            ) : (
              <div className="space-y-3">
                {search.data.chunks.map((chunk, index) => {
                  const scorePct = Math.round(chunk.score * 100);
                  const isSafe = chunk.score >= minThreshold;

                  return (
                    <Card
                      key={`${chunk.source}-${index}`}
                      className={`p-4 transition ${
                        isSafe
                          ? 'border-emerald-500/30 bg-emerald-500/[0.02]'
                          : 'border-amber-500/25 bg-amber-500/[0.02]'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-400">
                            #{index + 1}
                          </span>
                          <span className="text-sm font-semibold text-slate-100">{chunk.source}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge tone={isSafe ? 'success' : 'warning'}>
                            {isSafe ? `Voice-Safe (${scorePct}%)` : `Below Threshold (${scorePct}%)`}
                          </Badge>
                          <span className="text-xs text-slate-500">
                            (Target: {Math.round(minThreshold * 100)}%)
                          </span>
                        </div>
                      </div>

                      <p className="mt-3 font-mono text-xs leading-6 text-slate-300 whitespace-pre-wrap">
                        {chunk.excerpt}
                      </p>

                      <div className="mt-3 flex items-center justify-between pt-2 text-[11px] text-slate-500">
                        <span>Grounded Vector Chunk</span>
                        <span>{isSafe ? '✓ Injected into Agent Context' : '✗ Suppressed by Policy'}</span>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
