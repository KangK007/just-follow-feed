# 开发与迁移说明

## 开发环境

- Node.js 24 LTS（项目的 `engines` 约束）
- npm 11（使用提交到仓库的 `package-lock.json`）
- Windows 本机抓取功能还需要 Python 3.11、Git，以及 Microsoft Edge 或 Google Chrome

首次迁移到新电脑时，在项目根目录执行：

```powershell
npm ci
Copy-Item .env.example .env.local
```

只需要使用抖音/哔站同步时，再执行 `scripts/setup-sidecar.ps1` 配置 Cookie 和本机令牌。Cookie、令牌、浏览器 IndexedDB 数据和抓取服务代码都不属于 Git 仓库；浏览器中的数据请先从“管理数据”导出 JSON 备份，再在新电脑中导入。

## 常用命令

```powershell
npm run dev          # 仅启动 Next.js 开发服务器
npm run start:local  # 启动网站和本机抓取服务
npm run check:local  # 检查本机服务状态与令牌鉴权
npm run verify       # 类型检查、Lint、测试和生产构建
npm run stop:local   # 停止由本项目启动的服务
```

## 修改约定

1. 不要提交 `.env.local`、`.local/`、`node_modules/`、`.next/`、日志、缓存或 `outputs/`。
2. 不要覆盖原始 Cookie、浏览器数据或本地备份；业务数据通过应用内 JSON 备份迁移。
3. 修改同步逻辑后至少运行 `npm run verify`，并说明平台接口、Cookie 和本机浏览器的未验证部分。
4. Pull Request 应说明改动文件、验证命令和已知限制。CI 会在 Node.js 24 上运行 `npm run verify`。

## 发布检查

推送前确认：

- `git status --short` 中没有凭据、个人路径或运行产物。
- `npm run verify` 成功。
- 如改动本机抓取服务，同时运行 `npm run audit:sidecar`。
