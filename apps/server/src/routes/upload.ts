import type { Express, Response } from 'express';
import multer from 'multer';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import { DocumentModel } from '../models/document.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';

// 記憶體暫存，不寫磁碟
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' ||
        file.mimetype === 'text/plain' ||
        file.mimetype === 'text/markdown') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, TXT, and Markdown files are supported'));
    }
  },
});

export function registerUploadRoutes(app: Express): void {

  // POST /api/v1/upload/file
  // Form fields: workspace_id (required), title (optional)
  // File field: file
  app.post(
    '/api/v1/upload/file',
    authMiddleware,
    upload.single('file'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'No file uploaded' });
          return;
        }

        const { workspace_id } = req.body;
        if (!workspace_id) {
          res.status(400).json({ error: 'workspace_id is required' });
          return;
        }

        let text = '';
        const mime = req.file.mimetype;
        const originalName = req.file.originalname.replace(/\.[^.]+$/, '');

        if (mime === 'application/pdf') {
          const parsed = await pdfParse(req.file.buffer);
          text = parsed.text;
        } else {
          // txt / md
          text = req.file.buffer.toString('utf-8');
        }

        if (!text.trim()) {
          res.status(422).json({ error: 'Could not extract text from file' });
          return;
        }

        // 建立文件
        const title = req.body.title?.trim() || originalName || 'Imported Document';
        const doc = await DocumentModel.create({
          workspace_id,
          title,
          content: { text },
          created_by: req.userId,
          metadata: {
            source: 'upload',
            filename: req.file.originalname,
            filesize: req.file.size,
            mimetype: mime,
            char_count: text.length,
          },
        });

        res.status(201).json({
          document: doc,
          extracted_chars: text.length,
          preview: text.slice(0, 200),
        });
      } catch (err: any) {
        console.error('[upload] error', err);
        res.status(500).json({ error: err.message || 'Upload failed' });
      }
    }
  );

  // POST /api/v1/upload/text  (直接貼文字建文件)
  app.post('/api/v1/upload/text', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { workspace_id, title, text } = req.body;
      if (!workspace_id || !text) {
        res.status(400).json({ error: 'workspace_id and text are required' });
        return;
      }
      const doc = await DocumentModel.create({
        workspace_id,
        title: title?.trim() || `Import ${new Date().toLocaleDateString('zh-TW')}`,
        content: { text },
        created_by: req.userId,
        metadata: { source: 'text_import', char_count: text.length },
      });
      res.status(201).json({ document: doc, extracted_chars: text.length });
    } catch {
      res.status(500).json({ error: 'Text import failed' });
    }
  });
}
