import { Component } from 'react';

export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('App error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'system-ui', maxWidth: '600px', margin: '0 auto' }}>
          <h1 style={{ color: '#991b1b' }}>Something went wrong</h1>
          <pre style={{ background: '#fee2e2', padding: '1rem', borderRadius: '8px', overflow: 'auto' }}>
            {this.state.error?.message || String(this.state.error)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
