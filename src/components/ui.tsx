import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { TAG, sortTags, type Tag } from '../lib/roles';
import { Scene } from './Scene';

export function TagChip({ id }: { id: string }) {
  const t = TAG[id as Tag];
  if (!t) return null;
  return <span className="tag" style={{ ['--c' as any]: t.color }} title={t.about}>{t.label}</span>;
}
export function Tags({ tags }: { tags: string[] }) {
  if (!tags.length) return <span className="muted small">No tags yet</span>;
  return <span className="tags">{sortTags(tags).map((t) => <TagChip key={t} id={t} />)}</span>;
}

/** Names the browser tab after the screen that is showing. */
export function useTitle(title: string) {
  useEffect(() => { document.title = `${title} | Black Tusk Companion`; }, [title]);
}

/** Frame for every screen behind the main menu. */
export function Page({ title, sub, children, bar, width }: {
  title: string; sub?: ReactNode; children: ReactNode; bar?: ReactNode; width?: 'wide' | 'full';
}) {
  useTitle(title);
  useEffect(() => { window.scrollTo(0, 0); }, [title]);
  return (
    <>
      <Scene quiet />
      <div className={`page ${width === 'full' ? 'page--full' : ''}`}>
        <header className="page__head">
          <h1 className="page__title">{title}</h1>
          {sub && <p className="page__sub">{sub}</p>}
        </header>
        <main className={`page__body ${width ? `page__body--${width}` : ''}`}>{children}</main>
        <footer className="page__bar">
          <Link to="/" className="btn back">Back</Link>
          <span className="spacer" />
          {bar}
        </footer>
      </div>
    </>
  );
}

let open = 0;      // pop-ups on screen (one can open another)
export function Modal({ title, children, foot, onClose, wide }: {
  title: string; children: ReactNode; foot?: ReactNode; onClose?: () => void; wide?: boolean;
}) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  // While a pop-up is open the page behind it does not scroll; only the pop-up does.
  useEffect(() => {
    const root = document.documentElement; open += 1; root.classList.add('has-modal');
    return () => { open -= 1; if (open <= 0) { open = 0; root.classList.remove('has-modal'); } };
  }, []);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal__box ${wide ? 'modal__box--wide' : ''}`}>
        <div className="modal__head">{title}</div>
        <div className="modal__body">{children}</div>
        {foot && <div className="modal__foot">{foot}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, children, action, danger, busy, onConfirm, onClose }: {
  title: string; children: ReactNode; action: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose} foot={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className={`btn ${danger ? 'btn--danger' : 'btn--go'}`} disabled={busy} onClick={onConfirm}>{action}</button>
    </>}>{children}</Modal>
  );
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
export function ago(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 60) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
export const num = (n: number) => n.toLocaleString('en-US');
