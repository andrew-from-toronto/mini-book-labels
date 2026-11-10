import type { Book, Filters, SortKey } from '../lib/types';

interface Props {
  books: Book[];
  filters: Filters;
  onChange: (f: Filters) => void;
}

export function FiltersPanel({ books, filters, onChange }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const statuses = [...new Set(books.map((b) => b.status))].sort();
  const years = [...new Set(books.flatMap((b) => (b.lastRead ? [b.lastRead.slice(0, 4)] : [])))].sort().reverse();
  const year = years.find((y) => filters.from === `${y}-01-01` && filters.to === `${y}-12-31`) ?? '';

  return (
    <div className="fields">
      <fieldset>
        <legend>Read status</legend>
        {statuses.map((s) => (
          <label key={s} className="check">
            <input
              type="checkbox"
              checked={filters.statuses.includes(s)}
              onChange={(e) =>
                set({
                  statuses: e.target.checked ? [...filters.statuses, s] : filters.statuses.filter((x) => x !== s),
                })
              }
            />
            {s.replace(/-/g, ' ')}
          </label>
        ))}
      </fieldset>

      <label>
        Minimum rating: {filters.minRating > 0 ? `${filters.minRating} stars` : 'any'}
        <input
          type="range"
          min={0}
          max={5}
          step={0.25}
          value={filters.minRating}
          onChange={(e) => set({ minRating: Number(e.target.value) })}
        />
      </label>

      <div className="row">
        <label>
          Year read
          <select
            value={year}
            onChange={(e) => {
              const y = e.target.value;
              set(y ? { from: `${y}-01-01`, to: `${y}-12-31` } : { from: '', to: '' });
            }}
          >
            <option value="">Any</option>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>
        <label>
          Read from
          <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label>
          Read to
          <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
        </label>
      </div>

      <div className="row">
        <label>
          Sort by
          <select value={filters.sort} onChange={(e) => set({ sort: e.target.value as SortKey })}>
            <option value="rating">Highest rated</option>
            <option value="date-read">Most recently read</option>
            <option value="title">Title</option>
          </select>
        </label>
        <label>
          Take top
          <input
            type="number"
            min={1}
            value={filters.count}
            onChange={(e) => set({ count: Math.max(1, Math.floor(Number(e.target.value)) || 1) })}
          />
        </label>
      </div>
    </div>
  );
}
