import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={
      <div className="flex items-center justify-center h-screen bg-surface text-text-tertiary">
        <div className="text-center">
          <div className="text-4xl mb-4">💥</div>
          <p className="text-sm mb-2">應用程式發生嚴重錯誤</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-accent hover:bg-accent-hover rounded-lg text-white text-sm mt-2 transition-colors"
          >重新載入</button>
        </div>
      </div>
    }>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
