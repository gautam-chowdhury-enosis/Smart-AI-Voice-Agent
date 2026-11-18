import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  FileUp,
  HardDrive,
  Layers,
  Loader2,
  RotateCw,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';

import { AccessibleDialog } from '../../../components/ui/AccessibleDialog';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { adminApi } from '../../../lib/api';
import type { KnowledgeDocumentScope, PersonaOption } from '../../../types/api';

const MAX_BYTES_PER_FILE = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ['.pdf', '.md', '.txt'];

export interface StagedBatchFile {
  id: string;
  file: File;
  status: 'staged' | 'uploading' | 'indexed' | 'failed';
  error?: string;
  chunksIndexed?: number;
}

export interface BatchUploadDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  personaOptions: readonly PersonaOption[];
  onBatchComplete?: () => void;
}

/**
 * Multi-file batch drag-and-drop uploader drawer with queue staging,
 * global access scoping, per-file status tracking, and partial-failure recovery.
 */
export function BatchUploadDrawer({
  isOpen,
  onClose,
  personaOptions,
  onBatchComplete,
}: BatchUploadDrawerProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [queue, setQueue] = useState<StagedBatchFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [accessScope, setAccessScope] = useState<KnowledgeDocumentScope>('tenant_wide');
  const [selectedPersonas, setSelectedPersonas] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [validationWarning, setValidationWarning] = useState<string | null>(null);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const addFilesToQueue = (files: FileList | File[]) => {
    setValidationWarning(null);
    const validFiles: StagedBatchFile[] = [];
    const rejectedNames: string[] = [];

    Array.from(files).forEach((file) => {
      const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
      if (!ACCEPTED_TYPES.includes(ext) || file.size > MAX_BYTES_PER_FILE) {
        rejectedNames.push(file.name);
        return;
      }

      // Prevent exact duplicate files in the current staging queue
      const isDuplicate = queue.some(
        (item) => item.file.name === file.name && item.file.size === file.size,
      );
      if (!isDuplicate) {
        validFiles.push({
          id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          file,
          status: 'staged',
        });
      }
    });

    if (rejectedNames.length > 0) {
      setValidationWarning(
        `Skipped ${rejectedNames.length} file(s) exceeding 10 MB or unsupported format: ${rejectedNames.slice(0, 3).join(', ')}${
          rejectedNames.length > 3 ? '...' : ''
        }`,
      );
    }

    if (validFiles.length > 0) {
      setQueue((prev) => [...prev, ...validFiles]);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer.files) {
      addFilesToQueue(event.dataTransfer.files);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      addFilesToQueue(event.target.files);
    }
  };

  const removeFile = (id: string) => {
    if (isProcessing) return;
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const clearQueue = () => {
    if (isProcessing) return;
    setQueue([]);
    setValidationWarning(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const togglePersonaSelection = (key: string) => {
    setSelectedPersonas((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key],
    );
  };

  const executeBatchUpload = async () => {
    if (queue.length === 0 || isProcessing) return;

    const filesToUpload = queue.filter(
      (item) => item.status === 'staged' || item.status === 'failed',
    );
    if (filesToUpload.length === 0) return;

    setIsProcessing(true);
    let successCount = 0;

    for (const item of filesToUpload) {
      setQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, status: 'uploading', error: undefined } : q)),
      );

      try {
        const response = await adminApi.uploadKnowledgeDocument({
          file: item.file,
          scope: accessScope,
          assigned_personas: accessScope === 'persona_specific' ? selectedPersonas : [],
        });

        successCount++;
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? {
                  ...q,
                  status: 'indexed',
                  chunksIndexed: response.chunks_indexed,
                }
              : q,
          ),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload and indexing failed.';
        setQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, status: 'failed', error: message } : q)),
        );
      }
    }

    setIsProcessing(false);
    if (successCount > 0) {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'knowledge', 'documents'] });
      onBatchComplete?.();
    }
  };

  const totalBytes = queue.reduce((acc, item) => acc + item.file.size, 0);
  const indexedCount = queue.filter((item) => item.status === 'indexed').length;
  const failedCount = queue.filter((item) => item.status === 'failed').length;
  const pendingCount = queue.filter(
    (item) => item.status === 'staged' || item.status === 'uploading',
  ).length;

  const progressPercentage =
    queue.length > 0 ? Math.round((indexedCount / queue.length) * 100) : 0;

  return (
    <AccessibleDialog
      isOpen={isOpen}
      onClose={() => {
        if (!isProcessing) onClose();
      }}
      title="Batch Document Ingestion"
      description="Stage multiple operational documents for simultaneous ingestion into Grand Meridian knowledge base"
      className="max-w-3xl"
    >
      <div className="flex items-center justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-indigo-500/30 bg-indigo-500/10 text-indigo-400">
            <UploadCloud className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Batch Document Ingestion</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Drag and drop multiple files for simultaneous indexing
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={isProcessing}
          aria-label="Close batch upload modal"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900 transition disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Dropzone */}
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`mt-4 rounded-xl border border-dashed p-6 text-center transition ${
          isDragging
            ? 'border-indigo-400 bg-indigo-500/10'
            : 'border-slate-300 bg-slate-50 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-950/40 dark:hover:border-slate-600'
        }`}
      >
        <FileUp className="mx-auto h-7 w-7 text-indigo-300" />
        <p className="mt-2 text-sm font-medium text-slate-800 dark:text-slate-100">
          Drop multiple operational documents here
        </p>
        <p className="mt-1 text-xs text-slate-500">PDF, Markdown, or text · up to 10 MB per file</p>
        <Button
          type="button"
          variant="secondary"
          className="mt-3 text-xs"
          disabled={isProcessing}
          onClick={() => fileInputRef.current?.click()}
        >
          Browse multiple files
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_TYPES.join(',')}
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {validationWarning && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <span>{validationWarning}</span>
        </div>
      )}

      {/* Global Access Scope Assignment */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950/40">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Batch Access Scope
          </p>
          <span className="text-xs text-slate-500">Applied to all staged documents</span>
        </div>

        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-700 hover:border-slate-300 transition dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-200 dark:hover:border-slate-700">
            <input
              type="radio"
              name="batch-scope"
              checked={accessScope === 'tenant_wide'}
              onChange={() => setAccessScope('tenant_wide')}
              disabled={isProcessing}
              className="h-3.5 w-3.5 text-indigo-500 focus:ring-indigo-400"
            />
            <span>🌐 All Voice Personas (Shared)</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-700 hover:border-slate-300 transition dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-200 dark:hover:border-slate-700">
            <input
              type="radio"
              name="batch-scope"
              checked={accessScope === 'persona_specific'}
              onChange={() => setAccessScope('persona_specific')}
              disabled={isProcessing}
              className="h-3.5 w-3.5 text-indigo-500 focus:ring-indigo-400"
            />
            <span>🎯 Specific Personas (Restricted)</span>
          </label>
        </div>

        {accessScope === 'persona_specific' && (
          <div className="mt-3 flex flex-wrap gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            {personaOptions.map(({ key, name }) => {
              const isSelected = selectedPersonas.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  disabled={isProcessing}
                  onClick={() => togglePersonaSelection(key)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                    isSelected
                      ? 'border-indigo-400/40 bg-indigo-500/15 text-indigo-700 dark:text-indigo-100'
                      : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  {isSelected ? '☑' : '☐'} {name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Staged Queue Section */}
      <div className="mt-4">
        <div className="flex items-center justify-between pb-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Staging Queue ({queue.length})
            </h3>
            {queue.length > 0 && (
              <Badge tone="neutral" className="text-[10px]">
                {formatFileSize(totalBytes)}
              </Badge>
            )}
          </div>
          {queue.length > 0 && !isProcessing && (
            <button
              type="button"
              onClick={clearQueue}
              className="text-xs text-slate-400 hover:text-rose-400 transition"
            >
              Clear Queue
            </button>
          )}
        </div>

        {queue.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/20">
            No files staged in the queue yet. Drop files above or browse to get started.
          </div>
        ) : (
          <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
            {queue.map((item) => (
              <div
                key={item.id}
                className={`flex items-center justify-between rounded-lg border p-2.5 text-xs transition ${
                  item.status === 'indexed'
                    ? 'border-emerald-500/30 bg-emerald-500/[0.04]'
                    : item.status === 'failed'
                      ? 'border-rose-500/30 bg-rose-500/[0.04]'
                      : item.status === 'uploading'
                        ? 'border-indigo-500/40 bg-indigo-500/[0.06]'
                        : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/40'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0 pr-2">
                  <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800 dark:text-slate-200">{item.file.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {formatFileSize(item.file.size)}
                      {item.chunksIndexed !== undefined && ` · ${item.chunksIndexed} chunks indexed`}
                      {item.error && <span className="text-rose-400"> · {item.error}</span>}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {item.status === 'uploading' && (
                    <Badge tone="warning">
                      <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                      Indexing…
                    </Badge>
                  )}
                  {item.status === 'indexed' && (
                    <Badge tone="success">
                      <CheckCircle2 className="mr-1 inline h-3 w-3" />
                      Indexed
                    </Badge>
                  )}
                  {item.status === 'failed' && <Badge tone="danger">Failed</Badge>}
                  {item.status === 'staged' && <Badge tone="neutral">Ready</Badge>}

                  {!isProcessing && (
                    <button
                      type="button"
                      onClick={() => removeFile(item.id)}
                      aria-label={`Remove ${item.file.name} from queue`}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-500 transition dark:hover:bg-slate-800 dark:hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Aggregate Progress Indicator */}
      {isProcessing && (
        <div className="mt-4 rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3">
          <div className="flex items-center justify-between text-xs text-indigo-200">
            <span className="flex items-center gap-1.5 font-medium">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Ingesting documents ({indexedCount} of {queue.length} completed)...
            </span>
            <span>{progressPercentage}%</span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Footer Actions */}
      <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-4 dark:border-slate-800">
        <div className="flex items-center gap-2">
          {indexedCount > 0 && (
            <span className="text-xs text-emerald-400">
              ✓ {indexedCount} document(s) successfully indexed
            </span>
          )}
          {failedCount > 0 && (
            <span className="text-xs text-rose-400">
              ⚠ {failedCount} failed (see error details above)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isProcessing}
          >
            {indexedCount > 0 && pendingCount === 0 ? 'Close' : 'Cancel'}
          </Button>
          <Button
            type="button"
            onClick={executeBatchUpload}
            disabled={isProcessing || pendingCount === 0}
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Ingesting...
              </>
            ) : failedCount > 0 && pendingCount === 0 ? (
              <>
                <RotateCw className="mr-1.5 h-4 w-4" />
                Retry Failed ({failedCount})
              </>
            ) : (
              `Start Ingestion (${pendingCount})`
            )}
          </Button>
        </div>
      </div>
    </AccessibleDialog>
  );
}
