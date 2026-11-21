# Mio · 绘页官网

`site/` 是独立的 Vite + React + TypeScript 静态官网，和 `web/` 创作应用分别开发、构建与部署。无需启动 Python 或连接 ComfyUI，也不读取工作区、令牌或本机服务。

官网中的交互演示只在浏览器里切换预置内容，不生成新图片、不调用后端或付费 API。真实创作仍需下载并启动 Mio，再自行配置可用的本地或云端生图服务。

## 开发与验证

需要 Node.js 22（至少 22.12）或更新的受支持版本。在仓库根目录执行：

1. 安装独立依赖并启动开发服务：

   ```powershell
   npm ci --prefix site
   npm --prefix site run dev
   ```

2. 完成编辑后集中运行检查与构建：

   ```powershell
   npm --prefix site run format:check
   npm --prefix site run typecheck
   npm --prefix site test
   npm --prefix site run build
   node site/scripts/postbuild.mjs --check
   ```

构建产物在 `site/dist/`，不要提交 `dist/` 或 `node_modules/`。组件测试使用 jsdom，部署脚本回归使用原生 Node.js 测试运行器，不安装浏览器、不跑 E2E。

### 路径与公开地址

| 环境变量         | 默认值 | 用途                                                                                                            |
| ---------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| `VITE_BASE_PATH` | `/`    | 资源部署根路径，如 `/comfy-comic-studio/`；必须是绝对路径                                                       |
| `VITE_SITE_URL`  | 不设置 | 公开站点完整 URL，可包含与 base 一致的子路径；用于 canonical、Open Graph、Twitter、sitemap 与 robots 的绝对 URL |

例如在 PowerShell 中验证 GitHub 项目站点：

```powershell
$env:VITE_BASE_PATH = '/comfy-comic-studio/'
$env:VITE_SITE_URL = 'https://lumingya.github.io/comfy-comic-studio/'
npm --prefix site run build
node site/scripts/postbuild.mjs --check
Remove-Item Env:VITE_BASE_PATH, Env:VITE_SITE_URL
```

POSIX shell 可写为 `VITE_BASE_PATH=/comfy-comic-studio/ VITE_SITE_URL=https://lumingya.github.io/comfy-comic-studio/ npm --prefix site run build`；单独执行 `--check` 时要传入相同变量。

构建后的 `scripts/postbuild.mjs` 会核对 HTML、CSS 的本地资源是否存在、路径是否落在 base 下，拒绝把本机地址写入元信息。有公开 URL 时生成 canonical、`og:url`、绝对社交分享图、`sitemap.xml` 与包含 sitemap 的 `robots.txt`；无公开 URL 时省略 canonical、`og:url`、sitemap，保留本地分享图路径与允许抓取的 robots。分享图来自仓库内的 `public/og-image.png`。`--check` 只验证已有产物，不改写文件。

## 两步部署到 GitHub Pages

1. 在 GitHub 仓库的 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。部署环境使用 `github-pages`，建议把该环境的部署分支限制为 `main`。这一步需要仓库管理权限，提交工作流不会自动修改远端设置。官方说明见[配置发布源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

2. 将 `site/` 和 `.github/workflows/deploy-pages.yml` 推送至 `main`。工作流会先运行格式、类型、组件与部署脚本测试，再构建并检查静态资源和 SEO，最后上传 `site/dist/` 并部署。也可在 Actions 中手动运行 **Deploy Mio website to Pages**；只有 `main` 会发布。成功后的公开地址显示在工作流部署环境里。

工作流根据 `GITHUB_REPOSITORY` 自动计算地址：普通仓库使用 `https://owner.github.io/repository/` 和 `/repository/`；仓库名为 `owner.github.io` 时使用站点根路径 `/`，无需硬编码仓库名。可在仓库 **Settings → Secrets and variables → Actions → Variables** 中设置可选的 `VITE_SITE_URL`，覆盖公开域名；其路径必须和计算的 base 相同。自定义根域名网站可直接以 `VITE_BASE_PATH=/` 和公开 URL 构建，再把 `site/dist/` 部署到任意静态托管；GitHub 自定义域名本身仍须在 Pages 设置中配置。

构建任务只有读取仓库与 Pages 配置的权限，部署任务仅有 `pages: write` 和 `id-token: write`；同一时间只进行一轮发布。流程使用 GitHub 官方的 `configure-pages`、`upload-pages-artifact` 和 `deploy-pages`，详见[自定义 Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
