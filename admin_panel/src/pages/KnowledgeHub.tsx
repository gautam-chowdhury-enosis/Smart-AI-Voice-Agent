import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  CheckCircle2,
  FileText,
  FileUp,
  FlaskConical,
  Layers,
  Settings2,
  UploadCloud,
} from 'lucide-react';

import { KnowledgeMatrix } from '../components/KnowledgeMatrix';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import {
  useAvailablePersonas,
  useDeleteKnowledgeDocument,
  useKnowledgeDocuments,
  useToggleDocumentStatus,
  useUpdateDocumentAssignments,
  useUploadKnowledgeDocument,
} from '../hooks/useAdminApi';
import type { KnowledgeDocument, KnowledgeDocumentScope } from '../types/api';
import { BatchUploadDrawer } from './knowledge/components/BatchUploadDrawer';
import { ChunkInspectorDrawer } from './knowledge/components/ChunkInspectorDrawer';
import { DocumentAccessModal } from './knowledge/components/DocumentAccessModal';
import { DocumentList } from './knowledge/components/DocumentList';
import {
  GroundingPolicyWorkbench,
  type GroundingPolicyDraft,
} from './knowledge/components/GroundingPolicyWorkbench';
import { RetrievalPlayground } from './knowledge/components/RetrievalPlayground';

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ['.pdf', '.md', '.txt'];

type KnowledgeTab = 'documents' | 'playground' | 'policies';

/**
 * Tenant-scoped knowledge base operations cockpit featuring 3-tab segmented navigation:
 * 1. Document Management & Scoping Matrix
 * 2. Decoupled Retrieval Playground Simulator
 * 3. Persona Grounding Safety Policies
 */
export function KnowledgeHub() {
  const [activeTab, setActiveTab] = useState<KnowledgeTab>('documents');
  const personaOptions = useAvailablePersonas();
  const documents = useKnowledgeDocuments();
  const upload = useUploadKnowledgeDocument();
  const updateAssignments = useUpdateDocumentAssignments();
  const toggleStatus = useToggleDocumentStatus();
  const deleteDocument = useDeleteKnowledgeDocument();

  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [accessScope, setAccessScope] = useState<KnowledgeDocumentScope>('tenant_wide');
  const [selectedPersonas, setSelectedPersonas] = useState<string[]>([]);
  const [editingDocument, setEditingDocument] = useState<KnowledgeDocument | null>(null);
  const [deletingDocument, setDeletingDocument] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [orphanConfirmDoc, setOrphanConfirmDoc] = useState<{
    documentId: string;
    documentName: string;
  } | null>(null);
  const [isBatchOpen, setIsBatchOpen] = useState(false);
  const [inspectingDocument, setInspectingDocument] = useState<KnowledgeDocument | null>(null);

  // Grounding policy drafts keyed by persona to preserve edits across tab switches
  const [policyDrafts, setPolicyDrafts] = useState<Record<string, GroundingPolicyDraft>>({});

  const updateDraftPolicy = (personaKey: string, patch: Partial<GroundingPolicyDraft>) => {
    setPolicyDrafts((prev) => ({
      ...prev,
      [personaKey]: {
        ...(prev[personaKey] ?? {
          grounding_mode: 'hybrid_balanced',
          min_relevance_score: 0.65,
          max_chunks_per_turn: 3,
          custom_fallback_spoken: '',
        }),
        ...patch,
      },
    }));
  };

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

  const cancelSelectedFile = () => {
    setSelectedFile(null);
    setFileError(null);
    setAccessScope('tenant_wide');
    setSelectedPersonas([]);
    if (inputRef.current) inputRef.current.value = '';
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
          if (inputRef.current) inputRef.current.value = '';
        },
      },
    );
  };

  const togglePersonaSelection = (personaKey: string) => {
    setSelectedPersonas((current) =>
      current.includes(personaKey)
        ? current.filter((key) => key !== personaKey)
        : [...current, personaKey],
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
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) =>
    chooseFile(event.target.files?.[0]);

  const applyMatrixAssignment = (
    documentId: string,
    nextAssignments: string[],
    allPersonaKeys: string[],
  ) => {
    const nextScope: KnowledgeDocumentScope =
      nextAssignments.length >= allPersonaKeys.length ? 'tenant_wide' : 'persona_specific';

    updateAssignments.mutate({
      documentId,
      scope: nextScope,
      assigned_personas: nextScope === 'tenant_wide' ? [] : nextAssignments,
    });
  };

  const handleMatrixToggle = (documentId: string, personaKey: string, nextValue: boolean) => {
    const targetDocument = documents.data?.find((document) => document.id === documentId);
    if (!targetDocument) return;

    const allPersonaKeys = personaOptions.map((persona) => persona.key);
    const currentAssigned =
      targetDocument.scope === 'tenant_wide'
        ? allPersonaKeys
        : (targetDocument.assigned_personas ?? []);

    const nextAssignments = nextValue
      ? [...new Set([...currentAssigned, personaKey])]
      : currentAssigned.filter((key) => key !== personaKey);

    if (nextAssignments.length === 0) {
      setOrphanConfirmDoc({
        documentId,
        documentName: targetDocument.name,
      });
      return;
    }

    applyMatrixAssignment(documentId, nextAssignments, allPersonaKeys);
  };

  const confirmOrphanAssignment = () => {
    if (!orphanConfirmDoc) return;
    updateAssignments.mutate(
      {
        documentId: orphanConfirmDoc.documentId,
        scope: 'persona_specific',
        assigned_personas: [],
      },
      {
        onSettled: () => setOrphanConfirmDoc(null),
      },
    );
  };

  const handleDeleteDocument = (documentId: string, documentName: string) => {
    setDeletingDocument({ id: documentId, name: documentName });
  };

  return (
    <div className="mx-auto max-w-7xl animate-in fade-in duration-500">
      <header className="mb-6">
        <p className="text-sm font-semibold text-indigo-300">RETRIEVAL OPERATIONS</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Knowledge Hub
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
          Stage operational documents, cross-check multi-persona scoping, and test live
          conversational retrieval guardrails for Grand Meridian.
        </p>
      </header>

      {/* 3-Tab Segmented Cockpit Navigation */}
      <div className="mb-6 flex border-b border-slate-800 space-x-6">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'documents'}
          onClick={() => setActiveTab('documents')}
          className={`flex items-center gap-2 pb-3.5 text-sm font-semibold border-b-2 transition ${
            activeTab === 'documents'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-slate-400 hover:border-slate-700 hover:text-slate-200'
          }`}
        >
          <FileText className="h-4 w-4" />
          Documents & Access Matrix
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'playground'}
          onClick={() => setActiveTab('playground')}
          className={`flex items-center gap-2 pb-3.5 text-sm font-semibold border-b-2 transition ${
            activeTab === 'playground'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-slate-400 hover:border-slate-700 hover:text-slate-200'
          }`}
        >
          <FlaskConical className="h-4 w-4" />
          Retrieval Playground
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'policies'}
          onClick={() => setActiveTab('policies')}
          className={`flex items-center gap-2 pb-3.5 text-sm font-semibold border-b-2 transition ${
            activeTab === 'policies'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-slate-400 hover:border-slate-700 hover:text-slate-200'
          }`}
        >
          <Settings2 className="h-4 w-4" />
          Grounding Policies
        </button>
      </div>

      {/* Tab 1: Documents & Scoping Matrix */}
      {activeTab === 'documents' && (
        <div className="space-y-6">
          <Card className="p-5 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="section-title">Add Knowledge</h2>
                <p className="section-copy">PDF, Markdown, or text · maximum 10 MB</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="text-xs"
                  onClick={() => setIsBatchOpen(true)}
                >
                  <Layers className="mr-1.5 h-3.5 w-3.5 text-indigo-400" />
                  Batch Upload
                </Button>
                <UploadCloud className="h-5 w-5 text-indigo-300" />
              </div>
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
                isDragging
                  ? 'border-indigo-400 bg-indigo-500/10'
                  : 'border-slate-700 bg-slate-950/35'
              }`}
            >
              <FileUp className="mx-auto h-8 w-8 text-indigo-300" />
              <p className="mt-4 text-sm font-semibold text-slate-100">
                Drop a policy document here
              </p>
              <p className="mt-1 text-sm text-slate-500">or choose a file from your computer</p>
              <Button
                variant="secondary"
                className="mt-5"
                onClick={() => inputRef.current?.click()}
              >
                Browse files
              </Button>
              <input
                ref={inputRef}
                className="hidden"
                type="file"
                accept={ACCEPTED_TYPES.join(',')}
                onChange={handleFileChange}
              />
            </div>
            {selectedFile && (
              <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-emerald-100">
                      {selectedFile.name}
                    </p>
                    <p className="mt-1 text-xs text-emerald-200/65">
                      {(selectedFile.size / 1024).toFixed(1)} KB · tenant: grand-meridian
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={upload.isPending}
                      onClick={cancelSelectedFile}
                    >
                      Cancel
                    </Button>
                    <Button disabled={upload.isPending} onClick={uploadFile}>
                      {upload.isPending ? 'Indexing…' : 'Index now'}
                    </Button>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Agent access
                  </p>
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
                      {personaOptions.map(({ key, name }) => {
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
              <p
                role="alert"
                className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm leading-6 text-rose-100"
              >
                {fileError ??
                  (upload.error instanceof Error
                    ? upload.error.message
                    : 'The document could not be indexed.')}
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
            onInspectChunks={(doc) => setInspectingDocument(doc)}
            personaOptions={personaOptions}
          />

          {documents.data && (
            <KnowledgeMatrix
              documents={documents.data}
              personas={personaOptions}
              onToggleAssignment={handleMatrixToggle}
            />
          )}
        </div>
      )}

      {/* Tab 2: Decoupled Retrieval Playground */}
      {activeTab === 'playground' && (
        <RetrievalPlayground
          personaOptions={personaOptions}
          onNavigateToDocuments={() => setActiveTab('documents')}
        />
      )}

      {/* Tab 3: Persona Grounding Safety Policies */}
      {activeTab === 'policies' && (
        <GroundingPolicyWorkbench
          personaOptions={personaOptions}
          drafts={policyDrafts}
          onUpdateDraft={updateDraftPolicy}
        />
      )}

      {/* Manage Access Modal */}
      <DocumentAccessModal
        document={editingDocument}
        isOpen={Boolean(editingDocument)}
        onClose={() => setEditingDocument(null)}
        onSave={saveAccessChanges}
        isSaving={updateAssignments.isPending}
        personaOptions={personaOptions}
      />

      {/* Document Deletion Confirmation Dialog */}
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

      {/* Orphan Document Warning Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(orphanConfirmDoc)}
        title="Make document inaccessible to all agents?"
        description={`Unchecking all personas will make "${orphanConfirmDoc?.documentName}" inaccessible to all voice agents during calls. The document will remain indexed, but no voice agent will retrieve from it.`}
        confirmText="Remove Access"
        cancelText="Cancel"
        isDestructive={false}
        isPending={updateAssignments.isPending}
        onConfirm={confirmOrphanAssignment}
        onCancel={() => setOrphanConfirmDoc(null)}
      />

      {/* Multi-File Batch Uploader Drawer */}
      <BatchUploadDrawer
        isOpen={isBatchOpen}
        onClose={() => setIsBatchOpen(false)}
        personaOptions={personaOptions}
      />

      {/* Vector Chunk Inspector Drawer */}
      <ChunkInspectorDrawer
        isOpen={Boolean(inspectingDocument)}
        onClose={() => setInspectingDocument(null)}
        document={inspectingDocument}
      />
    </div>
  );
}
