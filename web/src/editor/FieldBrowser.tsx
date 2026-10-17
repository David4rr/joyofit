import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/ui/utils";
import { fieldRows, filterRows, makeFieldElement, type FieldRow } from "./fieldBrowser";
import { useEditor } from "./store";

const BADGE_CLASS: Record<FieldRow["level"], string> = {
  verified: "bg-battery-soft text-battery-ink",
  experimental: "bg-warning-soft text-warning",
  "preview-only": "bg-muted text-muted-foreground",
};

function Row({ row, onAdd }: { row: FieldRow; onAdd: (row: FieldRow) => void }) {
  const { info, action } = row;
  const enabled = action.state.enabled;
  return (
    <li className="rounded-xl bg-muted/60 p-2.5" data-testid={`field-row-${info.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[0.8125rem] font-bold">{info.name}</p>
          <p className="text-[0.6875rem] text-muted-foreground">
            id {info.id} · {info.category}
            {row.label && ` · Studio: ${row.label}`}
            {row.slot && ` · slot ${row.slot}`}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold", BADGE_CLASS[row.level])} data-testid={`field-badge-${info.id}`}>
          {row.badge}
        </span>
      </div>
      <p className="mt-1 text-[0.6875rem] text-muted-foreground">Draws as {row.drawTypes.join(", ")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!enabled}
          aria-label={`${action.label}: ${info.name}`}
          data-testid={`field-add-${info.id}`}
          onClick={() => onAdd(row)}
          className="pressable h-7 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors duration-150 enabled:hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-foreground/10 disabled:text-muted-foreground"
        >
          {action.label}
        </button>
        {!action.state.enabled && (
          <span className="min-w-0 flex-1 text-[0.6875rem] text-muted-foreground" data-testid={`field-reason-${info.id}`}>
            {action.state.reason}
          </span>
        )}
      </div>
    </li>
  );
}

/** Every value id the codec knows, with what Studio can do with it. The evidence badge comes from the same function the export gate uses. */
export function FieldBrowser() {
  const addCustom = useEditor((s) => s.addCustom);
  const [query, setQuery] = useState("");
  const [usableOnly, setUsableOnly] = useState(false);
  const rows = useMemo(() => fieldRows(), []);
  const shown = filterRows(rows, query).filter((r) => !usableOnly || r.action.state.enabled);

  return (
    <div className="space-y-2" data-testid="field-browser">
      <div className="sticky top-0 z-10 -mx-1 space-y-2 bg-card px-1 pb-1">
        <label className="flex h-9 items-center gap-2 rounded-xl bg-muted px-3 focus-within:ring-[3px] focus-within:ring-ring/25">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            type="search"
            aria-label="Search fields"
            data-testid="field-search"
            placeholder="Search name, id or category"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            className="min-w-0 flex-1 bg-transparent text-[0.8125rem] font-semibold outline-none placeholder:font-normal"
          />
        </label>
        <label className="flex items-center gap-2 px-0.5 text-xs font-semibold text-muted-foreground">
          <input type="checkbox" checked={usableOnly} onChange={(e) => setUsableOnly(e.currentTarget.checked)} className="size-3.5" />
          Only fields I can add
        </label>
      </div>
      <p className="px-0.5 text-[0.6875rem] text-muted-foreground" data-testid="field-count">
        {shown.length} of {rows.length} codec ids
      </p>
      <ul className="space-y-1.5">
        {shown.map((row) => (
          <Row key={row.info.id} row={row} onAdd={(r) => addCustom(makeFieldElement(r.info.id, r.action.kind))} />
        ))}
      </ul>
      {shown.length === 0 && <p className="px-1 py-4 text-center text-[0.8125rem] text-muted-foreground">No field matches.</p>}
    </div>
  );
}
