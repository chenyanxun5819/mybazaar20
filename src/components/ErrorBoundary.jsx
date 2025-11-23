import { Component } from 'react';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] 捕获到错误:', error);
    console.error('[ErrorBoundary] 错误信息:', errorInfo);
    this.setState({
      error,
      errorInfo
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '2rem',
          margin: '2rem',
          backgroundColor: '#fee2e2',
          border: '2px solid #fecaca',
          borderRadius: '8px',
          fontFamily: 'Arial, sans-serif'
        }}>
          <h2 style={{ 
            color: '#991b1b',
            marginTop: 0,
            marginBottom: '1rem'
          }}>
            ❌ 出现错误
          </h2>
          <details style={{ 
            whiteSpace: 'pre-wrap',
            backgroundColor: '#fef2f2',
            padding: '1rem',
            borderRadius: '4px',
            marginBottom: '1rem',
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            color: '#7f1d1d',
            maxHeight: '300px',
            overflowY: 'auto'
          }}>
            <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>
              错误详情
            </summary>
            <div>
              <strong>错误信息:</strong>
              {this.state.error && this.state.error.toString()}
              {'\n\n'}
              <strong>组件堆栈:</strong>
              {this.state.errorInfo && this.state.errorInfo.componentStack}
            </div>
          </details>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null, errorInfo: null });
              window.location.reload();
            }}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#991b1b',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: '600'
            }}
          >
            🔄 重新加载页面
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
