import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

import { AccessibleDialog } from '../../../components/ui/AccessibleDialog';
import { Button } from '../../../components/ui/button';
import type { KnowledgeDocument, KnowledgeDocumentScope } from '../../../types/api';

export interface PersonaOption {
  key: string;
  name: string;
}

export interface DocumentAccessModalProps {
  document: KnowledgeDocument | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (documentId: string, scope: KnowledgeDocumentScope, assignedPersonas: string[]) => void;
  isSaving: boolean;
  personaOptions: readonly PersonaOption[];
}

/** Accessible document access control modal replacing raw unconstrained overlay div. */
export function DocumentAccessModal({
  document,
  isOpen,
  onClose,
  onSave,
  isSaving,
  personaOptions,
}: DocumentAccessModalProps) {
  const [draftScope, setDraftScope] = useState<KnowledgeDocumentScope>('tenant_wide');
  const [draftPersonas, setDraftPersonas] = useState<string[]>([]);

  useEffect(() => {
    if (document) {
      setDraftScope(document.scope);
      setDraftPersonas(document.assigned_personas ?? []);
    }
  }, [document]);

  if (!document) return null;

  const togglePersona = (key: string) => {
    setDraftPersonas((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key],
    );
  };

  const handleSave = () => {
    onSave(
      document.id,
      draftScope,
      draftScope === 'persona_specific' ? draftPersonas : [],
    );
  };

  return (
    <AccessibleDialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Access settings for ${document.name}`}
      className="max-w-xl"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">
            Document access
          </p>
          <h3 className="mt-1 text-lg font-semibold text-white">{document.name}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-slate-700 p-2 text-slate-300 hover:border-slate-500 hover:text-white"
          aria-label="Close access modal"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-5 space-y-2">
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-2.5 text-sm text-slate-200">
          <input
            type="radio"
            name="document-access-modal"
            checked={draftScope === 'tenant_wide'}
            onChange={() => setDraftScope('tenant_wide')}
            className="h-4 w-4 border-slate-600 bg-slate-900 text-indigo-500"
          />
          🌐 All Voice Personas (Shared hotel policies)
        </label>
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-2.5 text-sm text-slate-200">
          <input
            type="radio"
            name="document-access-modal"
            checked={draftScope === 'persona_specific'}
            onChange={() => setDraftScope('persona_specific')}
            className="h-4 w-4 border-slate-600 bg-slate-900 text-indigo-500"
          />
          🎯 Specific Personas (Restricted scope)
        </label>
      </div>

      {draftScope === 'persona_specific' && (
        <div className="mt-5 flex flex-wrap gap-2">
          {personaOptions.map(({ key, name }) => {
            const selected = draftPersonas.includes(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => togglePersona(key)}
                className={`rounded-full border px-2.5 py-1.5 text-xs font-medium transition ${
                  selected
                    ? 'border-indigo-400/40 bg-indigo-500/15 text-indigo-100'
                    : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600'
                }`}
              >
                {selected ? '☑' : '☐'} {name}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-6 flex justify-end gap-3 border-t border-slate-800/80 pt-5">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? 'Saving…' : 'Save access'}
        </Button>
      </div>
    </AccessibleDialog>
  );
}
