## README Star History 图失效需 sealed_token

> 一句话结论：GitHub 2026-06 起限制 stargazers API 仅 admin/collaborator 可读，star-history.com 旧 `/svg` 端点返回空图，需改用带 `sealed_token` 的 `/chart` 端点

**你会遇到这个问题的场景**
README 里嵌入的 star-history 趋势图突然显示 "GitHub restricted access to star data"，或返回空白图。2026-06-30 GitHub 把 `/repos/{owner}/{repo}/stargazers` 端点限制为仓库 admin/collaborator 才能读，star-history.com 的服务器不是你仓库的 collaborator，旧的 `api.star-history.com/svg` 无鉴权请求拿不到数据。全站性问题，dify、cmux 等项目同期都受影响。

**为什么会出错**
- 旧 embed 用 `api.star-history.com/svg?repos=OWNER/REPO&type=Date`，无 token
- 限制后服务端无权限读 stargazers，返回空 SVG / 错误占位图
- no-scope token 即使对自己的仓库也不再工作，必须带权限

**正确做法**
1. 生成 fine-grained PAT（访问 https://github.com/settings/personal-access-tokens）：
   - Repository access：Only select repositories → 选目标仓库
   - Permissions → Repositories：
     ```
     └─ Repositories (2)
        ├─ Metadata (Required)   Read-only   ← stargazers 端点最低要求
        └─ Contents              Read and write   ← star-history.com 现要求 contents write
     ```
   - Expiration：建议 90 天～1 年，到期重新生成
2. 去 https://star-history.com 右上角 **Add access token**，粘贴 PAT 保存（存浏览器 local storage）
3. 访问 `https://www.star-history.com/?repos=OWNER%2FREPO&type=date&legend=top-left`
4. 滚到下方 **Show real-time chart on your README.md**，点 **Generate embed code**
5. 复制生成的 GitHub README.md 格式代码（含 `sealed_token`），替换 README 里的旧 embed。结构：
   ```html
   <a href="https://www.star-history.com/?repos=OWNER%2FREPO&type=date&legend=top-left">
     <picture>
       <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=OWNER/REPO&type=date&theme=dark&legend=top-left&sealed_token=XXX" />
       <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=OWNER/REPO&type=date&legend=top-left&sealed_token=XXX" />
       <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=OWNER/REPO&type=date&legend=top-left&sealed_token=XXX" />
     </picture>
   </a>
   ```
6. `sealed_token` 是 star-history.com 加密后的值，安全放在公开 README（服务端每次请求在内存解密读 stars，不存储不记录）；原始 PAT **不要**贴进 README

**反例**
❌ 错误：继续用 `api.star-history.com/svg?repos=...&type=Date` 无 token  
✅ 正确：改用 `api.star-history.com/chart?...&sealed_token=XXX`

---
_最后更新：2026-08-10_
