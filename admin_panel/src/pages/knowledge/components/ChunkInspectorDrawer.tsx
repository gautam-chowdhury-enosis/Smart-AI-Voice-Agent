import { useMemo, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  FileText,
  Hash,
  Layers,
  Loader2,
  Search,
  Sparkles,
  X,
} from 'lucide-react';

import { AccessibleDialog } from '../../../components/ui/AccessibleDialog';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { useDocumentChunks } from '../../../hooks/useAdminApi';
import type { KnowledgeDocument } from '../../../types/api';

const CHUNKS_PER_PAGE = 25;

export interface ChunkInspectorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  document: KnowledgeDocument | null;
}

/**
 * Slide-over Vector Chunk Inspector drawer providing transparent inspection
 * of ChromaDB semantic chunks, raw token estimates, and metadata filters.
 */
export function ChunkInspectorDrawer({
  isOpen,
  onClose,
  document,
}: ChunkInspectorDrawerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [copiedChunkId, setCopiedChunkId] = useState<string | null>(null);

  const chunksQuery = useDocumentChunks(isOpen && document ? document.id : null);
  const rawChunks = chunksQuery.data ?? [];

  // Filter chunks matching search query
  const filteredChunks = useMemo(() => {
    if (!searchQuery.trim()) return rawChunks;
    const query = searchQuery.toLowerCase().trim();
    return rawChunks.filter(
      (chunk) =>
        chunk.text.toLowerCase().includes(query) ||
        chunk.id.toLowerCase().includes(query) ||
        String(chunk.metadata?.chunk_index ?? '').includes(query),
    );
  }, [rawChunks, searchQuery]);

  // Paginate filtered chunks (25 chunks/page to maintain smooth 60fps rendering)
  const totalPages = Math.max(1, Math.ceil(filteredChunks.length / CHUNKS_PER_PAGE));
  const effectivePage = Math.min(currentPage, totalPages);

  const paginatedChunks = useMemo(() => {
    const start = (effectivePage - 1) * CHUNKS_PER_PAGE;
    return filteredChunks.slice(start, start + CHUNKS_PER_PAGE);
  }, [filteredChunks, effectivePage]);

  const copyToClipboard = (chunkId: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedChunkId(chunkId);
    setTimeout(() => {
      setCopiedChunkId((prev) => (prev === chunkId ? null : prev));
    }, 2000);
  };

  if (!document) return null;

  return (
    <AccessibleDialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Vector Chunk Inspector: ${document.name}`}
      description="Inspect segmented text chunks, token allocations, and vector embeddings in the local store"
      className="max-w-4xl max-h-[90vh] flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-4 shrink-0 dark:border-slate-800">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-500/30 bg-indigo-500/10 text-indigo-400">
            <Layers className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold text-slate-900 dark:text-white">
                {document.name}
              </h2>
              <Badge tone="primary">
                {document.chunks_indexed} Chunks Indexed
              </Badge>
              <Badge tone="neutral">v{document.version}</Badge>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              Tenant: {document.tenant_id} · Doc ID: {document.id.slice(0, 8)}...
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close chunk inspector"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900 transition dark:hover:bg-slate-800 dark:hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Search & Metadata Bar */}
      <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Search chunk text, ID, or keywords..."
            className="field pl-8 pr-8 text-xs py-1.5"
            aria-label="Search within document chunks"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              aria-label="Clear chunk search query"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>
            Showing {filteredChunks.length} of {rawChunks.length} chunks
          </span>
          {searchQuery && (
            <Badge tone="accent" className="text-[10px]">
              Filtered
            </Badge>
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="mt-4 flex-1 overflow-y-auto space-y-3 pr-1 min-h-[300px]">
        {chunksQuery.isLoading ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
            <p className="mt-3 text-xs">Loading vector chunks from store...</p>
          </div>
        ) : chunksQuery.isError ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-center text-xs text-rose-200">
            <p className="font-medium">Failed to retrieve vector chunks.</p>
            <p className="mt-1 text-slate-400">
              The vector store may be undergoing synchronization or ChromaDB is temporarily unavailable.
            </p>
            <Button
              variant="secondary"
              className="mt-3 text-xs"
              onClick={() => chunksQuery.refetch()}
            >
              Retry inspection
            </Button>
          </div>
        ) : filteredChunks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/20 p-8 text-center text-xs text-slate-500">
            {searchQuery
              ? `No chunks match your search query: "${searchQuery}".`
              : 'No chunks found for this document. It may have been indexed with 0 readable text.'}
          </div>
        ) : (
          paginatedChunks.map((chunk, index) => {
            const chunkIndex =
              typeof chunk.metadata?.chunk_index === 'number'
                ? chunk.metadata.chunk_index
                : (effectivePage - 1) * CHUNKS_PER_PAGE + index;
            const estimatedTokens =
              chunk.token_count ?? Math.round(chunk.text.split(/\s+/).length * 1.3);

            return (
              <div
                key={chunk.id}
                className="group rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/50 dark:hover:border-slate-700"
              >
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-2.5 dark:border-slate-800/80">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1 font-mono text-xs font-semibold text-indigo-300">
                      <Hash className="h-3 w-3" />
                      Chunk #{chunkIndex + 1}
                    </span>
                    <Badge tone="neutral" className="text-[10px]">
                      ~{estimatedTokens} tokens
                    </Badge>
                    <span className="font-mono text-[11px] text-slate-500 truncate max-w-[200px]">
                      {chunk.id}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => copyToClipboard(chunk.id, chunk.text)}
                    aria-label={`Copy chunk ${chunkIndex + 1} text`}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                  >
                    {copiedChunkId === chunk.id ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Monospace Excerpt Text */}
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-800 whitespace-pre-wrap break-words selection:bg-indigo-500 selection:text-white dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                  {chunk.text}
                </div>

                {/* Chunk Metadata Footer */}
                {chunk.metadata && Object.keys(chunk.metadata).length > 0 && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500 font-mono">
                    <span className="text-slate-600">meta:</span>
                    {Object.entries(chunk.metadata).map(([key, val]) => (
                      <span
                        key={key}
                        className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 border border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800"
                      >
                        {key}: {String(val)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer & Pagination */}
      <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between border-t border-slate-200 pt-3 shrink-0 gap-3 dark:border-slate-800">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Database className="h-3.5 w-3.5 text-indigo-400" />
          <span>Local ChromaDB HNSW Cosine Space</span>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">
              Page {effectivePage} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="secondary"
                className="h-7 w-7 p-0"
                disabled={effectivePage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-7 w-7 p-0"
                disabled={effectivePage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        <Button type="button" variant="secondary" onClick={onClose} className="text-xs">
          Close Inspector
        </Button>
      </div>
    </AccessibleDialog>
  );
}
