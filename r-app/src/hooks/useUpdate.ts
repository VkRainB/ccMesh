import { useEffect } from "react";

import { updateApi } from "@/services/modules/update";
import { useUpdateStore } from "@/stores/modules/update";

/** 启动时按设置检查更新；有新版本（且未跳过）则置红点。 */
export function useUpdate() {
  const set = useUpdateStore((s) => s.set);

  useEffect(() => {
    updateApi
      .getSettings()
      .then((settings) => {
        if (!settings.autoCheck) return;
        updateApi
          .check()
          .then((info) => {
            if (info.available && info.version !== settings.skippedVersion) {
              set(true, info.version);
            }
          })
          .catch(() => undefined);
      })
      .catch(() => undefined);
  }, [set]);
}
