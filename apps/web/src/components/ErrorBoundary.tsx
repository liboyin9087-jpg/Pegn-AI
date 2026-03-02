import React, { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <div className="text-3xl mb-3">⚠️</div>
        <h3 className="text-sm font-semibold text-text-primary mb-1">此區塊發生錯誤</h3>
        <p className="text-xs text-text-tertiary mb-4 max-w-xs">
          {this.state.error?.message ?? '未知錯誤'}
        </p>
        <button
          onClick={() => this.setState({ hasError: false, error: null })}
          className="px-4 py-2 bg-accent hover:bg-accent-hover rounded-lg text-white text-xs transition-colors"
        >
          重試
        </button>
      </div>
    );
  }
}
