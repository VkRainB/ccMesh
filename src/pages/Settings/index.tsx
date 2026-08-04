import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { disable, enable } from "@tauri-apps/plugin-autostart";
import { toast } from "sonner";

import { SettingsGrid } from "@/components/settings";
import { useAutostartEnabled } from "@/hooks/useAutostartEnabled";
import { configApi } from "@/services/modules/config";
import { AdvancedCard } from "./_components/AdvancedCard";
import { GeneralCard } from "./_components/GeneralCard";
import { PetCard } from "./_components/PetCard";
import { ProxyCard } from "./_components/ProxyCard";
import { StartupCard } from "./_components/StartupCard";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Settings() {
  const qc = useQueryClient();
  const { data: cfg } = useQuery({ queryKey: ["config"], queryFn: configApi.getConfig });

  const save = async (patch: Record<string, string>) => {
    try {
      await configApi.setConfig(patch);
      qc.invalidateQueries({ queryKey: ["config"] });
    } catch (e) {
      toast.error(`保存失败：${errMsg(e)}`);
    }
  };

  const autostartQ = useAutostartEnabled();
  const toggleAutostart = async (on: boolean) => {
    try {
      if (on) await enable();
      else await disable();
      qc.invalidateQueries({ queryKey: ["autostart-enabled"] });
    } catch (e) {
      toast.error(`设置开机自启失败：${errMsg(e)}`);
      qc.invalidateQueries({ queryKey: ["autostart-enabled"] });
    }
  };

  const [testingProxy, setTestingProxy] = useState(false);
  const proxyRef = useRef<HTMLInputElement>(null);
  const testProxy = async () => {
    const url = (proxyRef.current?.value ?? "").trim() || cfg?.proxyUrl || "";
    setTestingProxy(true);
    try {
      const r = await configApi.testProxy(url);
      if (r.success) toast.success(`${r.message}（${r.latencyMs}ms）`);
      else toast.error(r.message);
    } catch (e) {
      toast.error(`测试失败：${errMsg(e)}`);
    } finally {
      setTestingProxy(false);
    }
  };

  if (!cfg) {
    return <p className="text-sm text-ink-mute">加载中…</p>;
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-light tracking-tight text-ink-primary">设置</h1>
      <SettingsGrid>
        <GeneralCard cfg={cfg} save={save} />
        <StartupCard
          cfg={cfg}
          save={save}
          autostartQ={autostartQ}
          toggleAutostart={toggleAutostart}
        />
        <AdvancedCard cfg={cfg} save={save} />
        <ProxyCard
          cfg={cfg}
          save={save}
          proxyRef={proxyRef}
          testProxy={testProxy}
          testingProxy={testingProxy}
        />
        <PetCard />
      </SettingsGrid>
    </div>
  );
}
