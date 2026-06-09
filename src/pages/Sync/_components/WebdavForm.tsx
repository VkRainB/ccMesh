import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { configApi, type WebDavConfig } from "@/services/modules/config";
import { webdavApi } from "@/services/modules/webdav";

const FIELDS: Array<{
  k: keyof WebDavConfig;
  label: string;
  type?: string;
  ph?: string;
}> = [
  { k: "url", label: "服务器 URL", ph: "https://dav.example.com/" },
  { k: "username", label: "用户名" },
  { k: "password", label: "密码", type: "password" },
  { k: "configPath", label: "配置路径", ph: "/ccMesh" },
];

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const EMPTY: WebDavConfig = {
  url: "",
  username: "",
  password: "",
  configPath: "",
  statsPath: "",
};

export function WebdavForm() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["config"], queryFn: configApi.getConfig });
  const [form, setForm] = useState<WebDavConfig>(EMPTY);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.webdav) setForm(data.webdav);
  }, [data]);

  const set = (k: keyof WebDavConfig, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const test = async () => {
    setTesting(true);
    try {
      const r = await webdavApi.test(form);
      r.success ? toast.success(r.message) : toast.error(r.message);
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await configApi.setConfig({
        webdav_url: form.url,
        webdav_username: form.username,
        webdav_password: form.password,
        webdav_configPath: form.configPath,
        webdav_statsPath: form.statsPath,
      });
      qc.invalidateQueries({ queryKey: ["config"] });
      qc.invalidateQueries({ queryKey: ["backups"] });
      toast.success("WebDAV 配置已保存");
    } catch (e) {
      toast.error(`保存失败：${errMsg(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-edge p-5">
      <h2 className="text-sm font-medium text-ink-secondary">WebDAV 配置</h2>
      <div className="grid grid-cols-2 gap-4">
        {FIELDS.map((f) => (
          <div key={f.k} className="flex flex-col gap-1.5">
            <Label htmlFor={f.k}>{f.label}</Label>
            <Input
              id={f.k}
              type={f.type ?? "text"}
              placeholder={f.ph}
              value={form[f.k]}
              onChange={(e) => set(f.k, e.target.value)}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={test} disabled={testing}>
          {testing ? "测试中…" : "测试连接"}
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </section>
  );
}
