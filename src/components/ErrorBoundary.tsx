import { Component, type ReactNode } from 'react';

/** If a screen breaks, show a way back instead of an empty page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { broken: boolean }> {
  state = { broken: false };
  static getDerivedStateFromError() { return { broken: true }; }
  componentDidCatch(error: unknown) { console.error(error); }
  render() {
    if (!this.state.broken) return this.props.children;
    return (
      <div className="page" style={{ justifyContent: 'center' }}>
        <div className="modal__box" style={{ margin: 'auto' }}>
          <div className="modal__head">This screen hit a snag</div>
          <div className="modal__body"><p>Something on this screen could not be shown. Your data is safe. Go back to the menu and try again; if it keeps happening, tell the Forgemaster which screen it was.</p></div>
          <div className="modal__foot"><a className="btn btn--go" href="#/" onClick={() => setTimeout(() => window.location.reload(), 0)}>Back to the menu</a></div>
        </div>
      </div>
    );
  }
}
