import { ChevronRightIcon, PawPrintIcon } from "lucide-react";

import { SettingCard, SettingDescRow } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { useLayoutStore } from "@/stores";

/** 设置页入口：跳转到宠物页面。 */
export function PetCard() {
  const setActiveView = useLayoutStore((s) => s.setActiveView);

  return (
    <SettingCard icon={PawPrintIcon} title="宠物">
      <SettingDescRow title="桌面宠物" desc="打开宠物页面">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setActiveView("pet")}
        >
          打开
          <ChevronRightIcon className="size-4" />
        </Button>
      </SettingDescRow>
    </SettingCard>
  );
}
