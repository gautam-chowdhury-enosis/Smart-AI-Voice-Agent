import { Search } from 'lucide-react';

import { Badge } from '../../../components/ui/badge';
import type { KnowledgeSearchResult } from '../../../types/api';

export interface PersonaOption {
  key: string;
  name: string;
}

export interface SearchState {
  isIdle: boolean;
  isPending: boolean;
  isError: boolean;
  error?: unknown;
  data?: KnowledgeSearchResult;
}

export interface SearchResultsProps {
  search: SearchState;
  selectedPersonaKey: string;
  personaOptions: readonly PersonaOption[];
}

/** Displays retrieval test results, including confidence matches, excerpts, and spoken fallbacks. */
export function SearchResults({
  search,
  selectedPersonaKey,
  personaOptions,
}: SearchResultsProps) {
  const activePersonaName =
    selectedPersonaKey === 'all'
      ? 'All knowledge'
      : personaOptions.find((option) => option.key === selectedPersonaKey)?.name ?? 'Selected persona';

  if (search.isIdle) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center text-center">
        <Search className="h-7 w-7 text-slate-600" />
        <p className="mt-3 text-sm font-medium text-slate-300">Run a retrieval test</p>
        <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">
          Results will show the source chunks available to the voice agent, limited by the same spoken-brevity policy.
        </p>
      </div>
    );
  }

  if (search.isPending) {
    return <div className="min-h-72 animate-pulse rounded-xl bg-slate-900/60" />;
  }

  if (search.isError) {
    return (
      <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm leading-6 text-rose-100">
        {search.error instanceof Error ? search.error.message : 'Search failed.'}
      </p>
    );
  }

  return (
    <div aria-live="polite" aria-atomic="true">
      {selectedPersonaKey !== 'all' && (
        <div className="mb-4 rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-3 text-xs font-medium text-indigo-100">
          Testing retrieval through {activePersonaName}&apos;s scope
        </div>
      )}
      {!search.data?.has_context ? (
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.07] p-5">
          <Badge tone="warning">No matching context</Badge>
          <p className="mt-4 text-sm font-medium text-amber-100">Spoken fallback</p>
          <p className="mt-2 text-sm leading-6 text-amber-100/75">
            &ldquo;{search.data?.fallback_spoken}&rdquo;
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-emerald-300">
              {search.data.chunks.length} relevant source{search.data.chunks.length === 1 ? '' : 's'}
            </p>
            <Badge tone="success">Voice-safe</Badge>
          </div>
          <div className="mt-4 space-y-3">
            {search.data.chunks.map((chunk, index) => (
              <article
                key={`${chunk.source}-${index}`}
                className="rounded-xl border border-slate-800 bg-slate-950/40 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-200">{chunk.source}</p>
                  <span className="text-xs font-medium text-indigo-300">
                    {Math.round(chunk.score * 100)}% match
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-400">{chunk.excerpt}</p>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
