import { AlertCircle, AlertTriangle, Files, Loader2, PencilLine, Trash2 } from 'lucide-react';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { formatDateTime } from '../../../lib/utils';
import type { KnowledgeDocument, PersonaOption } from '../../../types/api';

export interface DocumentListProps {
  documents: KnowledgeDocument[] | undefined;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRefetch: () => void;
  onToggleStatus: (documentId: string, nextStatus: boolean) => void;
  onManageAccess: (document: KnowledgeDocument) => void;
  onDeleteDocument: (documentId: string, documentName: string) => void;
  personaOptions: readonly PersonaOption[];
}

/** Operational document inventory list displaying chunk status, ingestion state machine, and scoping controls. */
export function DocumentList({
  documents,
  isLoading,
  isError,
  errorMessage,
  onRefetch,
  onToggleStatus,
  onManageAccess,
  onDeleteDocument,
  personaOptions,
}: DocumentListProps) {
  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="h-20 animate-pulse rounded-xl bg-slate-800" />
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="p-6">
        <p className="text-sm text-rose-200">
          {errorMessage || 'Document status is unavailable.'}
        </p>
        <Button variant="secondary" className="mt-4" onClick={onRefetch}>
          Try again
        </Button>
      </Card>
    );
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="section-title">Indexed documents</h2>
          <p className="section-copy">Active for this tenant</p>
        </div>
        <Badge tone="neutral">{documents?.length ?? 0}</Badge>
      </div>

      {documents?.length ? (
        <ul className="mt-5 space-y-3">
          {documents.map((document) => {
            const isIndexing =
              document.ingestion_status === 'indexing' || document.ingestion_status === 'pending';
            const isFailed = document.ingestion_status === 'failed';
            const isDeleting = document.ingestion_status === 'deleting';
            const isZeroChunks =
              document.chunks_indexed === 0 && document.ingestion_status === 'indexed';

            return (
              <li
                key={document.id ?? `${document.name}-${document.uploaded_at}`}
                className={`rounded-xl border p-3.5 transition ${
                  isDeleting ? 'pointer-events-none opacity-50' : ''
                } ${
                  isIndexing
                    ? 'border-indigo-500/40 bg-indigo-500/[0.04]'
                    : isFailed
                      ? 'border-rose-500/30 bg-rose-500/[0.03]'
                      : 'border-slate-800 bg-slate-950/35'
                }`}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-slate-100">{document.name}</p>

                      {isIndexing ? (
                        <Badge tone="warning">
                          <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                          {document.ingestion_status === 'indexing' ? 'Indexing…' : 'Queued'}
                        </Badge>
                      ) : isFailed ? (
                        <Badge tone="danger">Failed</Badge>
                      ) : isDeleting ? (
                        <Badge tone="neutral">Deleting…</Badge>
                      ) : (
                        <Badge tone={document.is_enabled ? 'success' : 'neutral'}>
                          {document.is_enabled ? 'Active' : 'Disabled'}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {document.chunks_indexed} chunks · {formatDateTime(document.uploaded_at)} · version {document.version}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 px-2 py-1.5 text-xs font-medium text-slate-200">
                      <span>{document.is_enabled ? 'Enabled' : 'Disabled'}</span>
                      <button
                        type="button"
                        role="switch"
                        disabled={isIndexing || isDeleting || isFailed}
                        aria-checked={document.is_enabled}
                        aria-label={`Toggle active status for ${document.name}`}
                        onClick={() => onToggleStatus(document.id, !document.is_enabled)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${
                          document.is_enabled ? 'bg-indigo-500' : 'bg-slate-700'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 rounded-full bg-white transition ${
                            document.is_enabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </label>
                    <Button
                      variant="secondary"
                      disabled={isIndexing || isDeleting}
                      aria-label={`Manage access for ${document.name}`}
                      onClick={() => onManageAccess(document)}
                    >
                      <PencilLine className="h-4 w-4" />Manage Access
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={isDeleting}
                      aria-label={`Delete ${document.name}`}
                      className="border border-slate-800 bg-slate-900/60 text-rose-200 hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() => onDeleteDocument(document.id, document.name)}
                    >
                      <Trash2 className="h-4 w-4" />Delete
                    </Button>
                  </div>
                </div>

                {isFailed && (
                  <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-200">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-rose-100">Indexing failed</p>
                      <p className="mt-0.5 leading-5 text-rose-200/80">
                        {document.ingestion_error ||
                          'Vector extraction or embedding timed out. Try re-uploading the file.'}
                      </p>
                    </div>
                  </div>
                )}

                {isZeroChunks && (
                  <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    <span>0 chunks extracted. If this is a scanned document, ensure OCR text is included before uploading.</span>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  {document.scope === 'tenant_wide' ? (
                    <Badge tone="neutral">All Personas</Badge>
                  ) : document.assigned_personas.length ? (
                    document.assigned_personas.map((personaKey) => {
                      const persona = personaOptions.find((option) => option.key === personaKey);
                      return (
                        <Badge key={`${document.id}-${personaKey}`} tone="primary">
                          {persona?.name ?? personaKey}
                        </Badge>
                      );
                    })
                  ) : (
                    <Badge tone="warning">No persona access</Badge>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-5 rounded-xl border border-dashed border-slate-700 p-5 text-center">
          <Files className="mx-auto h-5 w-5 text-slate-600" />
          <p className="mt-2 text-sm text-slate-500">No uploaded documents yet.</p>
        </div>
      )}
    </Card>
  );
}
