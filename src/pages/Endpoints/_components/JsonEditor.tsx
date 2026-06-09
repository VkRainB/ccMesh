import { json } from "@codemirror/lang-json";
import CodeMirror from "@uiw/react-codemirror";

interface Props {
  value: string;
  theme: "dark" | "light";
  onChange: (val: string) => void;
}

/** CodeMirror JSON 编辑器封装，供 EndpointForm 懒加载（仅打开 JSON 标签页时拉取 chunk）。 */
export default function JsonEditor({ value, theme, onChange }: Props) {
  return (
    <div className="overflow-hidden rounded-md border border-edge">
      <CodeMirror
        value={value}
        height="240px"
        width="100%"
        theme={theme}
        extensions={[json()]}
        onChange={onChange}
        className="text-sm"
        basicSetup={{ lineNumbers: true, foldGutter: false }}
      />
    </div>
  );
}
