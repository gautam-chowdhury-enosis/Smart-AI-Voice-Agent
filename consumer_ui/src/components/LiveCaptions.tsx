import { useEffect, useState } from 'react';
import { BookOpen, Captions, ChevronDown, ChevronUp, MessageCircleMore, UserRound } from 'lucide-react';

import type { CaptionLine, KnowledgeCitationModel } from '../types';

interface LiveCaptionsProps {
  captions: CaptionLine[];
  citation: KnowledgeCitationModel | null;
}

/** Accessible live transcript with clear speaker attribution and empty-state guidance. */
export function LiveCaptions({ captions, citation }: LiveCaptionsProps) {
  const [expanded, setExpanded] = useState(false);
  const latestAgentId = [...captions].reverse().find((caption) => caption.speaker === 'agent')?.id ?? null;

  useEffect(() => {
    setExpanded(false);
  }, [citation?.document_id, citation?.document_name]);

  return (
    <section className="min-h-[14rem] rounded-[1.6rem] border border-slate-200/90 bg-white/80 p-5 shadow-sm backdrop-blur" aria-labelledby="captions-heading">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="eyebrow">Conversation</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-950" id="captions-heading">Live captions</h2>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">
          <Captions className="h-3.5 w-3.5" /> Live transcript
        </span>
      </div>
      <div className="mt-5 space-y-4" aria-live="polite" aria-relevant="additions text">
        {captions.length === 0 ? (
          <div className="flex min-h-24 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-5 text-center">
            <MessageCircleMore className="h-5 w-5 text-slate-400" />
            <p className="mt-2 text-sm font-medium text-slate-600">Captions will appear as your conversation begins.</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">You can speak, hold Push to Talk, or use the text field below.</p>
          </div>
        ) : (
          captions.map((caption) => {
            const showCitation = citation && caption.speaker === 'agent' && caption.id === latestAgentId;
            return (
              <div className="flex gap-3" key={caption.id}>
                <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${caption.speaker === 'agent' ? 'bg-violet-100 text-violet-700' : 'bg-teal-100 text-teal-700'}`}>
                  {caption.speaker === 'agent' ? <span className="text-xs font-bold">E</span> : <UserRound className="h-3.5 w-3.5" />}
                </span>
                <div className="flex-1 pt-1 text-sm leading-6 text-slate-700">
                  <p>
                    <span className="mr-2 font-semibold text-slate-950">{caption.speaker === 'agent' ? 'Elena' : 'You'}</span>
                    {caption.text}
                    {!caption.isFinal && <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500" aria-label="Caption is still streaming" />}
                  </p>
                  {showCitation && (
                    <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50/80 p-2.5 text-xs text-indigo-900">
                      <button className="inline-flex items-center gap-1.5 font-medium text-indigo-700" onClick={() => setExpanded((current) => !current)} type="button">
                        <BookOpen className="h-3.5 w-3.5" />
                        Verified source: {citation.document_name}
                        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                      {expanded && (
                        <div className="mt-2 rounded-lg border border-indigo-100 bg-white/80 p-2.5 text-[11px] leading-5 text-slate-700">
                          <p className="font-semibold text-slate-900">{citation.document_name}</p>
                          <p className="mt-1 italic text-slate-600">“{citation.excerpt}”</p>
                          <p className="mt-1 text-indigo-700">Relevance: {citation.relevance_score.toFixed(2)}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
