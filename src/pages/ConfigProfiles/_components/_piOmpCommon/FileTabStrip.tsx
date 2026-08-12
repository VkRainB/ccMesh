export type RightFileTab = "provider" | "models" | "settings";

export function fileBaseName(path: string | undefined, fallback: string): string {
  if (!path) return fallback;
  const normalized = path.replace(/\\/g, "/");
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  return name || fallback;
}

/** 右侧文件 Tab：与 Claude Desktop 同款 pill strip。 */
export function FileTabStrip({
  value,
  tabs,
  onChange,
}: {
  value: RightFileTab;
  tabs: Array<{ value: RightFileTab; label: string }>;
  onChange: (value: RightFileTab) => void;
}) {
  return (
    <div className="min-w-0 max-w-full overflow-hidden">
      <div className="scrollbar-none w-full min-w-0 overflow-x-auto rounded-lg bg-muted p-[3px]">
        <div className="inline-flex w-max flex-nowrap items-center">
          {tabs.map((tab) => {
            const active = value === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => onChange(tab.value)}
                className={
                  "shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium transition-all " +
                  (active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-foreground/60 hover:text-foreground dark:text-muted-foreground")
                }
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function EditorFallback() {
  return (
    <div className="flex h-full min-h-[160px] items-center justify-center rounded-md border border-edge text-sm text-ink-mute">
      编辑器加载中…
    </div>
  );
}
