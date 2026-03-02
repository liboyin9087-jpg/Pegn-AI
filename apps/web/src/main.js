import { BlockEditor } from '@blocksuite/editor';
import { AffineEditorContainer } from '@blocksuite/presets';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';

// 確保 CSS 載入
import '@blocksuite/editor/themes/affine.css';

// 初始化 Yjs 文檔
const yDoc = new Y.Doc();

// 初始化 Hocuspocus 提供者
const provider = new HocuspocusProvider({
  url: 'ws://localhost:1234',
  name: 'my-first-document',
  document: yDoc,
  onConnect() {
    console.log('Connected to Hocuspocus server!');
    initializeEditor();
  },
  onDisconnect(event) {
    console.error('Disconnected from Hocuspocus server:', event);
  },
  onError(error) {
    console.error('Hocuspocus provider error:', error);
  },
});

// 建立 BlockEditor 實例
const editor = new BlockEditor({
  yDoc,
});

// 註冊 BlockSuite 預設區塊和功能
AffineEditorContainer.for(editor);

// 初始化編輯器函數
function initializeEditor() {
  const editorContainer = document.querySelector('.editor-container');

  if (editorContainer) {
    editor.mount(editorContainer);

    // 初始化編輯器內容（如果文檔是空的）
    if (yDoc.getMap('blocks').size === 0) {
      createInitialContent();
    }

    // 設置事件監聽器
    setupEventListeners();
    
    console.log('BlockSuite Editor mounted and ready.');
  } else {
    console.error('Editor container not found.');
  }
}

// 創建初始內容
function createInitialContent() {
  const page = editor.createPage({
    id: 'page1',
  });

  // 添加標題區塊
  const titleBlock = page.addBlock('affine:page', {
    title: new Y.Text('AI-Native Work OS 編輯器'),
  });

  // 添加各種類型的區塊示例
  const textBlock = page.addBlock('affine:paragraph', {
    text: new Y.Text('歡迎使用 AI-Native Work OS 編輯器！這是一個支援即時協作的區塊編輯器。'),
  });

  const headingBlock = page.addBlock('affine:heading', {
    level: 2,
    text: new Y.Text('功能特色'),
  });

  const featuresList = page.addBlock('affine:list', {
    text: new Y.Text('即時協作編輯'),
    type: 'bulleted',
  });

  page.addBlock('affine:list', {
    text: new Y.Text('CRDT 同步技術'),
    type: 'bulleted',
  });

  page.addBlock('affine:list', {
    text: new Y.Text('多種區塊類型支援'),
    type: 'bulleted',
  });

  // 添加程式碼區塊
  page.addBlock('affine:code', {
    text: new Y.Text(`// AI-Native Work OS 範例程式碼
function helloWorld() {
  console.log('Hello, AI-Native Work OS!');
  return 'Welcome to the future of collaborative editing';
}`),
    language: 'javascript',
  });

  // 添加引用區塊
  page.addBlock('affine:quote', {
    text: new Y.Text('協作編輯的未來，從現在開始。'),
  });

  // 添加分隔線
  page.addBlock('affine:divider');

  // 添加另一個標題
  page.addBlock('affine:heading', {
    level: 3,
    text: new Y.Text('開始使用'),
  });

  page.addBlock('affine:paragraph', {
    text: new Y.Text('開始編輯這份文檔，所有變更都會即時同步到其他協作者。'),
  });
}

// 設置事件監聽器
function setupEventListeners() {
  // 監聽文檔變更
  yDoc.on('update', (update, origin) => {
    if (origin !== provider) {
      console.log('Local change detected');
    } else {
      console.log('Remote change received');
    }
  });

  // 監聽區塊變更
  const blocks = yDoc.getMap('blocks');
  blocks.observe((event) => {
    console.log('Blocks changed:', event);
  });

  // 添加工具列按鈕（可選）
  addToolbarButtons();
}

// 添加工具列按鈕
function addToolbarButtons() {
  const toolbar = document.createElement('div');
  toolbar.className = 'editor-toolbar';
  toolbar.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: white;
    border: 1px solid #ccc;
    border-radius: 8px;
    padding: 10px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    z-index: 1000;
  `;

  const buttons = [
    { text: '新增段落', action: () => addBlock('affine:paragraph') },
    { text: '新增標題', action: () => addBlock('affine:heading') },
    { text: '新增程式碼', action: () => addBlock('affine:code') },
    { text: '新增列表', action: () => addBlock('affine:list') },
  ];

  buttons.forEach(btn => {
    const button = document.createElement('button');
    button.textContent = btn.text;
    button.style.cssText = `
      display: block;
      margin: 5px 0;
      padding: 8px 12px;
      border: 1px solid #ddd;
      background: #f5f5f5;
      border-radius: 4px;
      cursor: pointer;
    `;
    button.onclick = btn.action;
    toolbar.appendChild(button);
  });

  document.body.appendChild(toolbar);
}

// 添加新區塊的輔助函數
function addBlock(blockType) {
  const page = editor.getPage('page1');
  if (page) {
    let content = '';
    switch (blockType) {
      case 'affine:paragraph':
        content = '新段落文字';
        break;
      case 'affine:heading':
        content = '新標題';
        break;
      case 'affine:code':
        content = '// 新的程式碼區塊';
        break;
      case 'affine:list':
        content = '列表項目';
        break;
    }
    
    page.addBlock(blockType, {
      text: new Y.Text(content),
    });
  }
}

// 如果已連接，立即初始化
if (provider.status === 'connected') {
  initializeEditor();
}

// 確保在應用程式關閉時清理 Hocuspocus 提供者
window.addEventListener('beforeunload', () => {
  provider.destroy();
});
