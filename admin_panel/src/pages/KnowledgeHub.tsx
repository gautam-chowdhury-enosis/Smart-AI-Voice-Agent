import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { CheckCircle2, FileSearch, FileUp, Search, UploadCloud } from 'lucide-react';

import { KnowledgeMatrix } from '../components/KnowledgeMatrix';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import {
  useDeleteKnowledgeDocument,
  useKnowledgeDocuments,
  useKnowledgeSearch,
  usePersonaKnowledgeSettings,
  useToggleDocumentStatus,
  useUpdateDocumentAssignments,
  useUpdatePersonaKnowledgeSettings,
  useUploadKnowledgeDocument,
} from '../hooks/useAdminApi';
import type { KnowledgeDocument, KnowledgeDocumentScope } from '../types/api';
import { DocumentAccessModal } from './knowledge/components/DocumentAccessModal';
import { DocumentList } from './knowledge/components/DocumentList';
import { GroundingPolicyPanel, type GroundingPolicyDraft } from './knowledge/components/GroundingPolicyPanel';
import { SearchResults } from './knowledge/components/SearchResults';

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ['.pdf', '.md', '.txt'];
const PERSONA_OPTIONS = [
  { key: 'hotel_booking_specialist', name: 'Elena' },
  { key: 'restaurant_dining', name: 'Marco' },
  { key: 'travel_desk', name: 'Priya' },
  { key: 'customer_care', name: 'Jordan' },
] as const;

/** Tenant-scoped upload and retrieval testing workspace for operational knowledge. */
export function KnowledgeHub() {
  const documents = useKnowledgeDocuments();
  const upload = useUploadKnowledgeDocument();
  const updateAssignments = useUpdateDocumentAssignments();
  const toggleStatus = useToggleDocumentStatus();
  const deleteDocument = useDeleteKnowledgeDocument();
  const search = useKnowledgeSearch();
  const updatePersonaSettings = useUpdatePersonaKnowledgeSettings();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [accessScope, setAccessScope] = useState<KnowledgeDocumentScope>('tenant_wide');
  const [selectedPersonas, setSelectedPersonas] = useState<string[]>([]);
  const [editingDocument, setEditingDocument] = useState<KnowledgeDocument | null>(null);
  const [deletingDocument, setDeletingDocument] = useState<{ id: string; name: string } | null>(null);
  const [selectedPersonaKey, setSelectedPersonaKey] = useState<string>('all');
  const [query, setQuery] = useState('What time are check-in and check-out?');
  const [policyDraft, setPolicyDraft] = useState<GroundingPolicyDraft>({
    grounding_mode: 'hybrid_balanced',
    min_relevance_score: 0.65,
    max_chunks_per_turn: 3,
    custom_fallback_spoken: '',
  });
  const activePersonaKey = selectedPersonaKey === 'all' ? 'hotel_booking_specialist' : selectedPersonaKey;
  const personaSettings = usePersonaKnowledgeSettings(activePersonaKey);

  useEffect(() => {
    if (!personaSettings.data) return;
    setPolicyDraft({
      grounding_mode: personaSettings.data.grounding_mode,
      min_relevance_score: personaSettings.data.min_relevance_score,
      max_chunks_per_turn: personaSettings.data.max_chunks_per_turn,
      custom_fallback_spoken: personaSettings.data.custom_fallback_spoken ?? '',
    });
  }, [personaSettings.data]);

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    const extension = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
    if (!ACCEPTED_TYPES.includes(extension)) {
      setFileError('Choose a PDF, Markdown, or text file.');
      setSelectedFile(null);
      return;
    }
    if (file.size > MAX_BYTES) {
      setFileError('Documents must be 10 MB or smaller.');
      setSelectedFile(null);
      return;
    }
    setFileError(null);
    setSelectedFile(file);
    setAccessScope('tenant_wide');
    setSelectedPersonas([]);
  };

  const uploadFile = () => {
    if (!selectedFile) return;
    upload.mutate(
      {
        file: selectedFile,
        scope: accessScope,
        assigned_personas: accessScope === 'persona_specific' ? selectedPersonas : [],
      },
      {
        onSuccess: () => {
          setSelectedFile(null);
          setAccessScope('tenant_wide');
          setSelectedPersonas([]);
        },
      },
    );
  };

  const togglePersonaSelection = (personaKey: string) => {
    setSelectedPersonas((current) =>
      current.includes(personaKey) ? current.filter((key) => key !== personaKey) : [...current, personaKey],
    );
  };

  const openAccessDrawer = (document: KnowledgeDocument) => {
    setEditingDocument(document);
  };

  const saveAccessChanges = (
    documentId: string,
    scope: KnowledgeDocumentScope,
    assignedPersonas: string[],
  ) => {
    updateAssignments.mutate(
      {
        documentId,
        scope,
        assigned_personas: assignedPersonas,
      },
      { onSuccess: () => setEditingDocument(null) },
    );
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  };
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => chooseFile(event.target.files?.[0]);
  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length >= 2) {
      search.mutate({
        query: query.trim(),
        persona_key: selectedPersonaKey === 'all' ? undefined : selectedPersonaKey,
      });
    }
  };

  const handleMatrixToggle = (documentId: string, personaKey: string, nextValue: boolean) => {
    const targetDocument = documents.data?.find((document) => document.id === documentId);
    if (!targetDocument) return;
    const nextAssignments = nextValue
      ? [...new Set([...(targetDocument.assigned_personas ?? []), personaKey])]
      : (targetDocument.assigned_personas ?? []).filter((key) => key !== personaKey);
    updateAssignments.mutate({
      documentId,
      scope: nextAssignments.length > 0 ? 'persona_specific' : 'persona_specific',
      assigned_personas: nextAssignments,
    });
  };

  const savePersonaSettings = () => {
    updatePersonaSettings.mutate({
      personaKey: activePersonaKey,
      payload: {
        grounding_mode: policyDraft.grounding_mode,
        min_relevance_score: Number(policyDraft.min_relevance_score.toFixed(2)),
        max_chunks_per_turn: policyDraft.max_chunks_per_turn,
        custom_fallback_spoken: policyDraft.custom_fallback_spoken.trim() || null,
      },
    });
  };

  const handleDeleteDocument = (documentId: string, documentName: string) => {
    setDeletingDocument({ id: documentId, name: documentName });
  };

  return (
    <div className="mx-auto max-w-7xl animate-in fade-in duration-500">
      <header className="mb-8">
        <p className="text-sm font-semibold text-indigo-300">RETRIEVAL OPERATIONS</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Knowledge hub</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
          Stage operational knowledge for Grand Meridian, then test the exact retrieval guardrails used during voice calls.
        </p>
      </header>
      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-6">
          <Card className="p-5 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="section-title">Add knowledge</h2>
                <p className="section-copy">PDF, Markdown, or text · maximum 10 MB</p>
              </div>
              <UploadCloud className="h-5 w-5 text-indigo-300" />
            </div>
            <div
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`mt-6 rounded-2xl border border-dashed p-8 text-center transition ${
                isDragging ? 'border-indigo-400 bg-indigo-500/10' : 'border-slate-700 bg-slate-950/35'
              }`}
            >
              <FileUp className="mx-auto h-8 w-8 text-indigo-300" />
              <p className="mt-4 text-sm font-semibold text-slate-100">Drop a policy document here</p>
              <p className="mt-1 text-sm text-slate-500">or choose a file from your computer</p>
              <Button variant="secondary" className="mt-5" onClick={() => inputRef.current?.click()}>
                Browse files
              </Button>
              <input ref={inputRef} className="hidden" type="file" accept={ACCEPTED_TYPES.join(',')} onChange={handleFileChange} />
            </div>
            {selectedFile && (
              <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-emerald-100">{selectedFile.name}</p>
                    <p className="mt-1 text-xs text-emerald-200/65">{(selectedFile.size / 1024).toFixed(1)} KB · tenant: grand-meridian</p>
                  </div>
                  <Button disabled={upload.isPending} onClick={uploadFile}>
                    {upload.isPending ? 'Indexing…' : 'Index now'}
                  </Button>
                </div>

                <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Agent access</p>
                  <div className="mt-3 space-y-2">
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-2.5 text-sm text-slate-200">
                      <input
                        type="radio"
                        name="knowledge-access"
                        checked={accessScope === 'tenant_wide'}
                        onChange={() => setAccessScope('tenant_wide')}
                        className="h-4 w-4 border-slate-600 bg-slate-900 text-indigo-500"
                      />
                      🌐 All Voice Personas (Shared hotel policies)
                    </label>
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-2.5 text-sm text-slate-200">
                      <input
                        type="radio"
                        name="knowledge-access"
                        checked={accessScope === 'persona_specific'}
                        onChange={() => setAccessScope('persona_specific')}
                        className="h-4 w-4 border-slate-600 bg-slate-900 text-indigo-500"
                      />
                      🎯 Specific Personas (Restricted scope)
                    </label>
                  </div>

                  {accessScope === 'persona_specific' && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {PERSONA_OPTIONS.map(({ key, name }) => {
                        const isSelected = selectedPersonas.includes(key);
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => togglePersonaSelection(key)}
                            className={`rounded-full border px-2.5 py-1.5 text-xs font-medium transition ${
                              isSelected
                                ? 'border-indigo-400/40 bg-indigo-500/15 text-indigo-100'
                                : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600'
                            }`}
                          >
                            {isSelected ? '☑' : '☐'} {name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
            {(fileError || upload.isError) && (
              <p role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm leading-6 text-rose-100">
                {fileError ?? (upload.error instanceof Error ? upload.error.message : 'The document could not be indexed.')}
              </p>
            )}
            {upload.isSuccess && (
              <p className="mt-4 flex items-center gap-2 text-sm text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                Document indexed in {upload.data.chunks_indexed} voice-ready chunks.
              </p>
            )}
          </Card>
          <DocumentList
            documents={documents.data}
            isLoading={documents.isLoading}
            isError={documents.isError}
            errorMessage={documents.error instanceof Error ? documents.error.message : undefined}
            onRefetch={() => void documents.refetch()}
            onToggleStatus={(documentId, nextStatus) =>
              toggleStatus.mutate({ documentId, is_enabled: nextStatus })
            }
            onManageAccess={openAccessDrawer}
            onDeleteDocument={handleDeleteDocument}
            personaOptions={PERSONA_OPTIONS}
          />
          {documents.data && <KnowledgeMatrix documents={documents.data} onToggleAssignment={handleMatrixToggle} />}
        </div>
        <Card className="p-5 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="section-title">Search tester</h2>
              <p className="section-copy">Test tenant-scoped retrieval before a guest ever hears it.</p>
            </div>
            <FileSearch className="h-5 w-5 text-violet-300" />
          </div>
          <form className="mt-6" onSubmit={handleSearch}>
            <label>
              <span className="field-label">Ask the knowledge base</span>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  className="field"
                  value={query}
                  minLength={2}
                  maxLength={500}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <Button type="submit" disabled={search.isPending || query.trim().length < 2}>
                  {search.isPending ? 'Searching…' : <><Search className="h-4 w-4" />Test search</>}
                </Button>
              </div>
            </label>
            <label className="mt-4 block">
              <span className="field-label">Simulate as voice agent</span>
              <select
                value={selectedPersonaKey}
                onChange={(event) => setSelectedPersonaKey(event.target.value)}
                className="field mt-2"
              >
                <option value="all">All Knowledge (Unrestricted)</option>
                {PERSONA_OPTIONS.map(({ key, name }) => (
                  <option key={key} value={key}>{name}</option>
                ))}
              </select>
            </label>
          </form>
          <div className="mt-7 border-t border-slate-800 pt-6">
            <SearchResults
              search={search}
              selectedPersonaKey={selectedPersonaKey}
              personaOptions={PERSONA_OPTIONS}
            />
          </div>
          <div className="mt-7 border-t border-slate-800 pt-6">
            <GroundingPolicyPanel
              activePersonaKey={activePersonaKey}
              policyDraft={policyDraft}
              onChangePolicy={setPolicyDraft}
              onSavePolicy={savePersonaSettings}
              isSaving={updatePersonaSettings.isPending}
              isLoading={personaSettings.isPending}
              personaOptions={PERSONA_OPTIONS}
            />
          </div>
        </Card>
      </div>
      <DocumentAccessModal
        document={editingDocument}
        isOpen={Boolean(editingDocument)}
        onClose={() => setEditingDocument(null)}
        onSave={saveAccessChanges}
        isSaving={updateAssignments.isPending}
        personaOptions={PERSONA_OPTIONS}
      />

      <ConfirmDialog
        isOpen={Boolean(deletingDocument)}
        title={`Delete ${deletingDocument?.name ?? 'document'}?`}
        description="This will permanently delete this document and remove its extracted vector chunks from ChromaDB. Personas will no longer be grounded on this document."
        confirmText="Delete Document"
        cancelText="Cancel"
        isDestructive={true}
        isPending={deleteDocument.isPending}
        onConfirm={() => {
          if (deletingDocument) {
            deleteDocument.mutate(deletingDocument.id, {
              onSuccess: () => setDeletingDocument(null),
              onError: () => setDeletingDocument(null),
            });
          }
        }}
        onCancel={() => setDeletingDocument(null)}
      />
    </div>
  );
}
