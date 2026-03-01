import React from 'react';
import { Link2, FileText } from 'lucide-react';

interface Doc { id: string; title: string; content?: string; updatedAt?: string; }

interface Props {
  currentDoc: Doc;
  documents: Doc[];
  onNavigate: (docId: string) => void;
}

/** Finds all documents that contain [[currentDoc.title]] in their content. */
function findBacklinks(currentDoc: Doc, documents: Doc[]): Doc[] {
  const pattern = new RegExp(`\\[\\[${escapeRegExp(currentDoc.title)}\\]\\]`, 'i');
  return documents.filter(d => d.id !== currentDoc.id && d.content && pattern.test(d.content));
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default function BacklinksPanel({ currentDoc, documents, onNavigate }: Props) {
  const backlinks = findBacklinks(currentDoc, documents);

  if (backlinks.length === 0) return null;

  return (
    <div
      className="mt-8 pt-6"
      style={{ borderTop: '1px solid var(--color-border)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <Link2 size={13} style={{ color: 'var(--color-text-quaternary)' }} />
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-quaternary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          反向連結 ({backlinks.length})
        </span>
      </div>

      {/* Links */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {backlinks.map(doc => {
          // Extract a short context snippet around the [[link]]
          const pattern = new RegExp(`(.{0,40})\\[\\[${escapeRegExp(currentDoc.title)}\\]\\](.{0,40})`, 'i');
          const match = doc.content?.match(pattern);
          const snippet = match ? `…${match[1]}[[${currentDoc.title}]]${match[2]}…` : '';

          return (
            <button
              key={doc.id}
              onClick={() => onNavigate(doc.id)}
              className="text-left flex items-start gap-2.5 px-3 py-2.5 rounded-lg transition-colors"
              style={{ background: 'transparent' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface-secondary)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <FileText size={13} style={{ color: 'var(--color-text-tertiary)', marginTop: 2, flexShrink: 0 }} />
              <div className="min-w-0">
                <p style={{ fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 500 }}>
                  {doc.title}
                </p>
                {snippet && (
                  <p className="truncate" style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 1 }}>
                    {snippet}
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
