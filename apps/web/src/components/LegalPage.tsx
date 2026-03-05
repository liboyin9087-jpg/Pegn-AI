import React, { useEffect, useState } from 'react';

type Tab = 'privacy' | 'terms' | 'dpa';

interface LegalDoc {
  document?: string;
  company?: string;
  last_updated?: string;
  contact?: string;
  summary?: Record<string, any>;
  full_document_url?: string;
  [key: string]: any;
}

interface LegalPageProps {
  onClose: () => void;
  initialTab?: Tab;
}

export default function LegalPage({ onClose, initialTab = 'privacy' }: LegalPageProps) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [doc, setDoc] = useState<LegalDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase = import.meta.env.VITE_API_URL ?? '';

  useEffect(() => {
    setLoading(true);
    setError(null);
    setDoc(null);
    fetch(`${apiBase}/api/v1/legal/${activeTab}`)
      .then(r => r.json())
      .then(data => setDoc(data))
      .catch(() => setError('Failed to load document'))
      .finally(() => setLoading(false));
  }, [activeTab, apiBase]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'privacy', label: 'Privacy Policy' },
    { id: 'terms', label: 'Terms of Service' },
    { id: 'dpa', label: 'DPA' },
  ];

  function renderValue(val: unknown, depth = 0): React.ReactNode {
    if (val === null || val === undefined) return null;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      return <span>{String(val)}</span>;
    }
    if (Array.isArray(val)) {
      return (
        <ul className="list-disc ml-4 mt-1 space-y-1">
          {val.map((item, i) => (
            <li key={i}>{renderValue(item, depth + 1)}</li>
          ))}
        </ul>
      );
    }
    if (typeof val === 'object') {
      return (
        <div className={depth > 0 ? 'ml-3 mt-1 space-y-2' : 'space-y-3'}>
          {Object.entries(val as Record<string, unknown>).map(([k, v]) => (
            <div key={k}>
              <span className="font-medium text-zinc-300 capitalize">{k.replace(/_/g, ' ')}: </span>
              {renderValue(v, depth + 1)}
            </div>
          ))}
        </div>
      );
    }
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700">
          <h2 className="text-lg font-semibold text-white">Legal Documents</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white transition-colors text-xl leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-700 px-6">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t.id
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 text-sm text-zinc-300 space-y-4">
          {loading && (
            <div className="text-zinc-500 text-center py-8">Loading…</div>
          )}
          {error && (
            <div className="text-red-400 text-center py-8">{error}</div>
          )}
          {doc && !loading && (
            <>
              {doc.last_updated && (
                <p className="text-xs text-zinc-500">Last updated: {doc.last_updated}</p>
              )}
              {doc.summary && renderValue(doc.summary)}
              {!doc.summary && doc.message && (
                <p className="text-zinc-400 italic">{doc.message}</p>
              )}
              {doc.full_document_url && (
                <p className="text-xs text-zinc-500 mt-4">
                  Full document:{' '}
                  <span className="text-blue-400">{doc.full_document_url}</span>
                </p>
              )}
              {doc.contact && (
                <p className="text-xs text-zinc-500">
                  Contact: <span className="text-blue-400">{doc.contact}</span>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
