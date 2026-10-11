import { Component, type ReactNode } from 'react';

/** Shows a plain message instead of a blank screen if a page fails. Data on the device is not affected. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('Screen error', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto mt-10 max-w-lg rounded-2xl border-2 border-red-700 bg-white p-6 text-navy">
        <h1 className="mb-2 text-xl font-bold">This screen could not be shown</h1>
        <p className="mb-4">Your data is safe on this device. Go back and try again. If it happens again, tell the office what you were doing.</p>
        <pre className="mb-4 max-h-32 overflow-auto rounded bg-gray-100 p-2 text-xs">{this.state.error.message}</pre>
        <button type="button" className="rounded-xl bg-navy px-4 py-3 font-semibold text-white" onClick={() => { this.setState({ error: null }); history.back(); }}>Go back</button>
      </div>
    );
  }
}
