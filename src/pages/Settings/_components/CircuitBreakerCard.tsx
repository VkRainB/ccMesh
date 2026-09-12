import { ShieldAlert } from "lucide-react";

import { SettingCard, SettingRow } from "@/components/settings";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { AppConfig } from "@/services/modules/config";

export function CircuitBreakerCard({
  cfg,
  save,
}: {
  cfg: AppConfig;
  save: (patch: Record<string, string>) => Promise<void>;
}) {
  return (
    <SettingCard icon={ShieldAlert} title="熔断保护">
      <SettingRow label="启用熔断保护">
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-mute">端点连续故障时自动跳闸并切换，冷却后自动探测恢复</span>
          <Switch
            checked={cfg.circuitBreakerEnabled}
            onCheckedChange={(v) => save({ circuitBreakerEnabled: String(v) })}
            aria-label="启用熔断保护"
          />
        </div>
      </SettingRow>
      <SettingRow label="连续失败阈值">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={50}
            className="w-24"
            disabled={!cfg.circuitBreakerEnabled}
            defaultValue={cfg.circuitBreakerFailureThreshold ?? 4}
            onBlur={(e) => {
              const val = Math.max(1, parseInt(e.target.value, 10) || 4);
              if (val !== cfg.circuitBreakerFailureThreshold) {
                save({ circuitBreakerFailureThreshold: String(val) });
              }
            }}
          />
          <span className="text-xs text-ink-mute">次（Claude 入站自动放宽）</span>
        </div>
      </SettingRow>
      <SettingRow label="熔断冷却时间">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={5}
            max={600}
            className="w-24"
            disabled={!cfg.circuitBreakerEnabled}
            defaultValue={cfg.circuitBreakerTimeout ?? 60}
            onBlur={(e) => {
              const val = Math.max(5, parseInt(e.target.value, 10) || 60);
              if (val !== cfg.circuitBreakerTimeout) {
                save({ circuitBreakerTimeout: String(val) });
              }
            }}
          />
          <span className="text-xs text-ink-mute">秒（5xx/网络错误的基础冷却）</span>
        </div>
      </SettingRow>
      <p className="text-xs text-ink-mute">
        提示：可在单个端点编辑弹窗中单独开启「禁止熔断」；修改后运行中的代理将自动重载生效。
      </p>
    </SettingCard>
  );
}
