import { useUpdateStore } from "@/stores/modules/update";

/** 有可用更新时显示的红点。 */
export function UpdateBadge() {
  const available = useUpdateStore((s) => s.available);
  if (!available) return null;
  return (
    <span
      className="inline-block size-2 rounded-full bg-destructive"
      aria-label="有可用更新"
    />
  );
}
