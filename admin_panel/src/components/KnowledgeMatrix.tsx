import { useAvailablePersonas, type PersonaOption } from '../hooks/useAdminApi';
import type { KnowledgeDocument } from '../types/api';
import { Badge } from './ui/badge';
import { Card } from './ui/card';

interface KnowledgeMatrixProps {
  documents: KnowledgeDocument[];
  personas?: readonly PersonaOption[];
  onToggleAssignment: (documentId: string, personaKey: string, nextValue: boolean) => void;
}

/**
 * Interactive matrix enabling direct cross-checking and 2-way scoping
 * of document knowledge across tenant voice personas.
 */
export function KnowledgeMatrix({
  documents,
  personas: externalPersonas,
  onToggleAssignment,
}: KnowledgeMatrixProps) {
  const fallbackPersonas = useAvailablePersonas();
  const personas = externalPersonas ?? fallbackPersonas;

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="section-title">Knowledge matrix</h2>
          <p className="section-copy">Cross-check and toggle access at a glance</p>
        </div>
        <Badge tone="accent">{documents.length} docs</Badge>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-y-2 text-left text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-slate-900/90 pr-4 pb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 backdrop-blur">
                Document
              </th>
              <th className="px-3 pb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                Scope
              </th>
              {personas.map(({ key, name }) => (
                <th
                  key={key}
                  className="px-3 pb-2 text-center text-xs font-semibold uppercase tracking-[0.2em] text-slate-400"
                >
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {documents.map((document) => {
              const isTenantWide = document.scope === 'tenant_wide';
              const assignedCount = isTenantWide
                ? personas.length
                : (document.assigned_personas?.length ?? 0);

              return (
                <tr key={document.id} className="rounded-xl border border-slate-800 bg-slate-950/35">
                  <td className="sticky left-0 z-10 rounded-l-xl border border-slate-800 bg-slate-950/90 px-3 py-3 align-middle backdrop-blur">
                    <div>
                      <p className="font-medium text-slate-100">{document.name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {document.chunks_indexed} chunks
                      </p>
                    </div>
                  </td>
                  <td className="border border-slate-800 bg-slate-950/35 px-3 py-3 align-middle">
                    {isTenantWide ? (
                      <Badge tone="neutral">Inherited (All)</Badge>
                    ) : assignedCount === 0 ? (
                      <Badge tone="warning">No Access (0)</Badge>
                    ) : (
                      <Badge tone="accent">
                        Restricted ({assignedCount}/{personas.length})
                      </Badge>
                    )}
                  </td>
                  {personas.map(({ key, name }) => {
                    const hasAccess =
                      isTenantWide || (document.assigned_personas ?? []).includes(key);
                    return (
                      <td
                        key={`${document.id}-${key}`}
                        className="border border-slate-800 bg-slate-950/35 px-3 py-3 text-center align-middle"
                      >
                        <input
                          type="checkbox"
                          checked={hasAccess}
                          aria-label={`${document.name} access for ${name}`}
                          onChange={() => onToggleAssignment(document.id, key, !hasAccess)}
                          className="h-4 w-4 cursor-pointer rounded border-slate-600 bg-slate-900 text-indigo-500 focus:ring-indigo-500"
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
