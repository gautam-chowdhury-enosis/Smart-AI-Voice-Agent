import { Badge } from './ui/badge';
import { Card } from './ui/card';
import type { KnowledgeDocument } from '../types/api';

const PERSONA_MATRIX = [
  { key: 'hotel_booking_specialist', name: 'Elena' },
  { key: 'restaurant_dining', name: 'Marco' },
  { key: 'travel_desk', name: 'Priya' },
  { key: 'customer_care', name: 'Jordan' },
] as const;

interface KnowledgeMatrixProps {
  documents: KnowledgeDocument[];
  onToggleAssignment: (documentId: string, personaKey: string, nextValue: boolean) => void;
}

/** A compact matrix showing which voice personas can access each document. */
export function KnowledgeMatrix({ documents, onToggleAssignment }: KnowledgeMatrixProps) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="section-title">Knowledge matrix</h2>
          <p className="section-copy">Cross-check access at a glance</p>
        </div>
        <Badge tone="accent">{documents.length} docs</Badge>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-y-2 text-left text-sm">
          <thead>
            <tr>
              <th className="pr-4 pb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Document</th>
              <th className="px-3 pb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Scope</th>
              {PERSONA_MATRIX.map(({ key, name }) => (
                <th key={key} className="px-3 pb-2 text-center text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {documents.map((document) => (
              <tr key={document.id} className="rounded-xl border border-slate-800 bg-slate-950/35">
                <td className="rounded-l-xl border border-slate-800 bg-slate-950/35 px-3 py-3 align-middle">
                  <div>
                    <p className="font-medium text-slate-100">{document.name}</p>
                    <p className="mt-1 text-xs text-slate-500">{document.chunks_indexed} chunks</p>
                  </div>
                </td>
                <td className="border border-slate-800 bg-slate-950/35 px-3 py-3 align-middle">
                  {document.scope === 'tenant_wide' ? (
                    <Badge tone="neutral">Inherited (All)</Badge>
                  ) : (
                    <Badge tone="accent">Restricted</Badge>
                  )}
                </td>
                {PERSONA_MATRIX.map(({ key }) => {
                  const hasAccess = document.scope === 'tenant_wide' || document.assigned_personas.includes(key);
                  return (
                    <td key={`${document.id}-${key}`} className="border border-slate-800 bg-slate-950/35 px-3 py-3 text-center align-middle">
                      {document.scope === 'tenant_wide' ? (
                        <Badge tone="neutral">✓</Badge>
                      ) : (
                        <input
                          type="checkbox"
                          checked={hasAccess}
                          onChange={() => onToggleAssignment(document.id, key, !hasAccess)}
                          className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-indigo-500 focus:ring-indigo-500"
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
