import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { configApi } from "@/services/modules/config";
import { logsApi } from "@/services/modules/logs";
import { windowApi } from "@/services/modules/window";
import { TokenCounter } from "./_components/TokenCounter";
import { UpdateSection } from "./_components/UpdateSection";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  );
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Settings() {
  const qc = useQueryClient();
  const { setTheme } = useTheme();
  const { data: cfg } = useQuery({ queryKey: ["config"], queryFn: configApi.getConfig });

  const save = async (patch: Record<string, string>) => {
    try {
      await configApi.setConfig(patch);
      qc.invalidateQueries({ queryKey: ["config"] });
    } catch (e) {
      toast.error(`保存失败：${errMsg(e)}`);
    }
  };

  if (!cfg) {
    return <p className="text-sm text-ink-mute">加载中…</p>;
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-light tracking-tight">设置</h1>

      <section className="flex flex-col divide-y divide-edge-subtle rounded-lg border border-edge">
        <Row label="代理端口">
          <Input
            className="w-32"
            defaultValue={String(cfg.port)}
            onBlur={(e) => save({ port: e.target.value })}
          />
        </Row>

        <Row label="主题">
          <Select
            value={cfg.theme}
            onValueChange={(v) => {
              setTheme(v);
              save({ theme: v });
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">跟随系统</SelectItem>
              <SelectItem value="light">浅色</SelectItem>
              <SelectItem value="dark">深色</SelectItem>
            </SelectContent>
          </Select>
        </Row>

        <Row label="定时自动切换主题">
          <Switch
            checked={cfg.themeAuto}
            onCheckedChange={(v) => save({ themeAuto: String(v) })}
          />
        </Row>

        {cfg.themeAuto && (
          <Row label="浅色 / 深色起始时间">
            <div className="flex items-center gap-2">
              <Input
                type="time"
                className="w-28"
                defaultValue={cfg.autoLightStart}
                onBlur={(e) => save({ autoLightStart: e.target.value })}
              />
              <Input
                type="time"
                className="w-28"
                defaultValue={cfg.autoDarkStart}
                onBlur={(e) => save({ autoDarkStart: e.target.value })}
              />
            </div>
          </Row>
        )}

        <Row label="语言">
          <Select
            value={cfg.language}
            onValueChange={(v) => {
              windowApi.setLanguage(v).catch(() => undefined);
              save({ language: v });
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh">中文</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </Row>

        <Row label="关闭窗口行为">
          <Select
            value={cfg.closeWindowBehavior}
            onValueChange={(v) => save({ closeWindowBehavior: v })}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ask">每次询问</SelectItem>
              <SelectItem value="minimize">最小化到托盘</SelectItem>
              <SelectItem value="quit">直接退出</SelectItem>
            </SelectContent>
          </Select>
        </Row>

        <Row label="日志级别">
          <Select
            value={cfg.logLevel}
            onValueChange={(v) => {
              logsApi.setLevel(v).catch(() => undefined);
              qc.invalidateQueries({ queryKey: ["config"] });
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["trace", "debug", "info", "warn", "error"].map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-ink-secondary">系统 / 高级</h2>
        <div className="flex flex-col divide-y divide-edge-subtle rounded-lg border border-edge">
          <Row label="代理地址">
            <Input
              className="w-64"
              placeholder="http://127.0.0.1:7890"
              defaultValue={cfg.proxyUrl}
              onBlur={(e) => save({ proxyUrl: e.target.value })}
            />
          </Row>
          <Row label="OpenAI 端点 UA（伪装，空=透传客户端）">
            <Input
              className="w-64"
              placeholder="留空透传客户端 UA"
              defaultValue={cfg.openaiUa}
              onBlur={(e) => save({ openaiUa: e.target.value })}
            />
          </Row>
          <Row label="Claude 端点 UA（伪装，空=透传客户端）">
            <Input
              className="w-64"
              placeholder="留空透传客户端 UA"
              defaultValue={cfg.claudeCliUa}
              onBlur={(e) => save({ claudeCliUa: e.target.value })}
            />
          </Row>
        </div>
      </section>

      <UpdateSection />
      <TokenCounter />
    </div>
  );
}
