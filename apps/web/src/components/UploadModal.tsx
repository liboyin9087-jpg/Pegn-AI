import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, X, FileText } from 'lucide-react';

interface Props {
  workspaceId: string;
  onClose: () => void;
  onUploaded: (doc: any) => void;
}

interface FileEntry {
  id: string;
  file: File;
  name: string;
  size: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
  progress: number;
  error?: string;
}

export default function UploadModal({ workspaceId, onClose, onUploaded }: Props) {
  const [entries, setEntries]   = useState<FileEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const formatSize = (bytes: number) =>
    bytes > 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${(bytes / 1024).toFixed(0)} KB`;

  const validateFile = (f: File) =>
    ['application/pdf', 'text/plain', 'text/markdown'].includes(f.type) ||
    f.name.endsWith('.md') || f.name.endsWith('.txt') || f.name.endsWith('.pdf');

  const addFiles = (files: File[]) => {
    const valid = files.filter(validateFile);
    const newEntries: FileEntry[] = valid.map(f => ({
      id: Math.random().toString(36).slice(2),
      file: f,
      name: f.name,
      size: formatSize(f.size),
      status: 'pending',
      progress: 0,
    }));
    setEntries(prev => [...prev, ...newEntries]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  const removeEntry = (id: string) => setEntries(prev => prev.filter(e => e.id !== id));

  const handleUploadAll = async () => {
    const pending = entries.filter(e => e.status === 'pending');
    if (!pending.length) return;
    setUploading(true);

    for (const entry of pending) {
      setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: 'uploading', progress: 20 } : e));
      try {
        const token = localStorage.getItem('auth_token');
        const form = new FormData();
        form.append('file', entry.file);
        form.append('workspace_id', workspaceId);
        form.append('title', entry.file.name.replace(/\.[^.]+$/, ''));

        const res = await fetch(
          (import.meta.env.VITE_API_URL ?? 'http://localhost:4000') + '/api/v1/upload/file',
          { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');

        setEntries(prev => prev.map(e =>
          e.id === entry.id ? { ...e, status: 'done', progress: 100 } : e
        ));
        onUploaded(data.document);
      } catch (err: any) {
        setEntries(prev => prev.map(e =>
          e.id === entry.id ? { ...e, status: 'error', error: err.message } : e
        ));
      }
    }
    setUploading(false);
  };

  const allDone = entries.length > 0 && entries.every(e => e.status === 'done' || e.status === 'error');
  const pendingCount = entries.filter(e => e.status === 'pending').length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="bg-white rounded-2xl shadow-2xl w-full overflow-hidden"
        style={{ maxWidth: 520 }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid #e8e8ea' }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1a1a2e' }}>匯入文件</h2>
            <p style={{ fontSize: 12, color: '#a0a0ae', marginTop: 2 }}>支援 PDF · TXT · Markdown（最大 20MB）</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: '#6b6b7a' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#f4f5f7')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <X size={16} />
          </button>
        </div>

        {/* Drop zone */}
        <div className="px-6 py-6">
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className="border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all duration-200"
            style={{
              borderColor: dragging ? '#2383e2' : '#e8e8ea',
              background:  dragging ? '#f0f7ff' : '#f9f9fb',
            }}
          >
            <motion.div animate={{ scale: dragging ? 1.1 : 1 }} transition={{ duration: 0.15 }}>
              <Upload size={28} className="mx-auto mb-3" style={{ color: dragging ? '#2383e2' : '#a0a0ae' }} />
            </motion.div>
            <p style={{ fontSize: 14, fontWeight: 500, color: '#1a1a2e', marginBottom: 4 }}>
              {dragging ? '放開以上傳' : '拖放或點擊選擇檔案'}
            </p>
            <p style={{ fontSize: 12, color: '#a0a0ae' }}>PDF · TXT · Markdown</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.txt,.md,text/plain,text/markdown,application/pdf"
              className="hidden"
              onChange={e => { if (e.target.files) addFiles(Array.from(e.target.files)); }}
            />
          </div>
        </div>

        {/* File list */}
        {entries.length > 0 && (
          <div className="px-6 pb-4" style={{ maxHeight: 240, overflowY: 'auto' }}>
            <AnimatePresence>
              {entries.map(entry => (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="flex items-center gap-3 p-3 rounded-xl mb-2"
                  style={{ background: '#f7f7f8' }}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 border"
                    style={{ background: 'white', borderColor: '#e8e8ea' }}
                  >
                    <FileText size={15} style={{ color: '#6b6b7a' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate" style={{ fontSize: 13, color: '#1a1a2e', fontWeight: 500 }}>
                      {entry.name}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {entry.status === 'uploading' && (
                        <>
                          <div className="flex-1 h-1 rounded-full" style={{ background: '#e8e8ea' }}>
                            <motion.div
                              className="h-1 rounded-full"
                              style={{ background: '#2383e2' }}
                              initial={{ width: 0 }}
                              animate={{ width: `${entry.progress}%` }}
                              transition={{ duration: 0.3 }}
                            />
                          </div>
                          <span style={{ fontSize: 10, color: '#a0a0ae', flexShrink: 0 }}>
                            {Math.round(entry.progress)}%
                          </span>
                        </>
                      )}
                      {entry.status === 'done' && (
                        <span style={{ fontSize: 11, color: '#10b981' }}>✓ 完成 · {entry.size}</span>
                      )}
                      {entry.status === 'error' && (
                        <span style={{ fontSize: 11, color: '#d44c47' }}>✗ {entry.error}</span>
                      )}
                      {entry.status === 'pending' && (
                        <span style={{ fontSize: 11, color: '#a0a0ae' }}>{entry.size}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => removeEntry(entry.id)}
                    className="p-1 rounded transition-colors"
                    style={{ color: '#a0a0ae' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#ebedf0')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <X size={12} />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 flex items-center justify-between gap-3" style={{ borderTop: '1px solid #e8e8ea' }}>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl border transition-colors"
            style={{ fontSize: 13, color: '#6b6b7a', borderColor: '#e8e8ea', background: 'white' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#f7f7f8')}
            onMouseLeave={e => (e.currentTarget.style.background = 'white')}
          >
            取消
          </button>
          <button
            onClick={allDone ? onClose : handleUploadAll}
            disabled={entries.length === 0 || uploading}
            className="px-5 py-2 rounded-xl text-white transition-opacity"
            style={{
              fontSize: 13, fontWeight: 500, background: '#2383e2',
              opacity: entries.length === 0 || uploading ? 0.4 : 1,
            }}
          >
            {allDone
              ? '完成'
              : uploading
              ? '上傳中…'
              : entries.length === 0
              ? '選擇檔案'
              : `匯入 ${pendingCount} 個檔案`
            }
          </button>
        </div>
      </motion.div>
    </div>
  );
}
