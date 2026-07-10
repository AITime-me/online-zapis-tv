type ListPaginationBarProps = {
  shownCount: number;
  total: number;
  page: number;
  totalPages: number;
  pageSize: number;
  pageSizes: readonly number[];
  loading?: boolean;
  onPageSizeChange: (pageSize: number) => void;
  onPrevious: () => void;
  onNext: () => void;
};

export function ListPaginationBar({
  shownCount,
  total,
  page,
  totalPages,
  pageSize,
  pageSizes,
  loading = false,
  onPageSizeChange,
  onPrevious,
  onNext,
}: ListPaginationBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-zinc-200 bg-white px-4 py-3">
      <p className="text-sm text-zinc-600">
        {loading
          ? "Загрузка…"
          : `Показано ${shownCount} из ${total} · страница ${page} из ${totalPages}`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <span>На странице</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
          >
            {pageSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onPrevious}
          disabled={page <= 1 || loading}
          className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
        >
          Назад
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={page >= totalPages || loading}
          className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
        >
          Далее
        </button>
      </div>
    </div>
  );
}
