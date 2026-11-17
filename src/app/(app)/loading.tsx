/** Shown while a page's data loads: the shape of the page, so nothing jumps when it arrives. */
export default function Loading() {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      <div>
        <div className="skeleton" style={{ width: 90, height: 18, marginBottom: 14 }} />
        <div className="skeleton" style={{ width: 280, height: 38 }} />
      </div>
      <div className="kpis">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton skeleton-card" style={{ height: 112 }} />)}
      </div>
      <div className="skeleton skeleton-card" style={{ height: 260 }} />
    </div>
  );
}
