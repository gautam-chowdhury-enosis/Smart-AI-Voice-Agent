import { Files, PencilLine, Trash2 } from 'lucide-react';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { formatDateTime } from '../../../lib/utils';
import type { KnowledgeDocument } from '../../../types/api';

export interface PersonaOption {
  key: string;
  name: string;
}

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

/** Operational document inventory list displaying chunk status and scoping controls. */
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
          {documents.map((document) => (
            <li
              key={document.id ?? `${document.name}-${document.uploaded_at}`}
              className="rounded-xl border border-slate-800 bg-slate-950/35 p-3"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-slate-100">
                      {document.name}
                    </p>
                    <Badge tone={document.is_enabled ? 'success' : 'neutral'}>
                      {document.is_enabled ? 'Active' : 'Disabled'}
                    </Badge>
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
                      aria-checked={document.is_enabled}
                      aria-label={`Toggle active status for ${document.name}`}
                      onClick={() => onToggleStatus(document.id, !document.is_enabled)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
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
                    aria-label={`Manage access for ${document.name}`}
                    onClick={() => onManageAccess(document)}
                  >
                    <PencilLine className="h-4 w-4" />Manage Access
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Delete ${document.name}`}
                    className="border border-slate-800 bg-slate-900/60 text-rose-200 hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-100"
                    onClick={() => onDeleteDocument(document.id, document.name)}
                  >
                    <Trash2 className="h-4 w-4" />Delete
                  </Button>
                </div>
              </div>

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
          ))}
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
