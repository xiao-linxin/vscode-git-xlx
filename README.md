# Git XLX

给【源代码管理】加一栏「仓库集」：把仓库列成一张带勾选的清单——勾上就打开、
取消就关闭，当前这套勾选可以存成具名集合，重启后自动套回。

解决 **几十个仓库全挤在【源代码管理 - 更改】里、日常只想看其中几个**的问题。

## 安装

| 渠道 | 方式 |
| --- | --- |
| VS Code 官方市场 | 扩展面板搜 `Git XLX` 或 `xiaolinxin.git-xlx` · <https://marketplace.visualstudio.com/items?itemName=xiaolinxin.git-xlx> |
| Open VSX（CodeBuddy / VSCodium 等） | 扩展面板搜 `git-xlx` · <https://open-vsx.org/extension/xiaolinxin/git-xlx> |
| VSIX | 扩展面板右上角 `…` → **从 VSIX 安装**，选 `git-xlx-<版本>.vsix`；或 `code --install-extension git-xlx-<版本>.vsix` |

> CodeBuddy 的插件商城就是 Open VSX（客户端 `product.json` 的 `extensionsGallery` 指向
> `open-vsx.org`），在 CodeBuddy 里搜 `git-xlx` 即可。

装完在【源代码管理】里会出现「仓库集」一栏；若没出现，重载一次窗口。

## 功能

- **自建「仓库集」栏**：挂在【源代码管理】下，和「存储库」「更改」并列，
  不改动原生那两个视图
- **勾选即打开 / 取消即关闭**：勾上 = `git.openRepository`，取消 = `git.close`，
  【更改】里就只剩勾选的仓库
  - 取消勾选后该仓库会从原生【存储库】列表消失，也不再被 git 跟踪
    （文件树没有 M/U 徽标、没有 diff 装饰，文件本身照常编辑）
  - 本扩展的「仓库集」栏始终列出全部已知仓库，未勾的标注「已关闭」
- **按仓库家族分组**：组头显示 `已选/总数`，例如 `go_service.worktrees 1/7`
- **保存 / 套用集合**：把当前打开的仓库存成具名集合，一键套回
- **启动自动对齐**：记住上次套用的集合（`activeSet`），下次启动自动关闭多余的、
  补开缺的；扫描静默 5 秒后才动手，避免把「还没扫到」的仓库误判成不该开
- **批量操作**：标题栏「全部取消选中」；分组右键「选中该节点全部仓库」/
  「取消该节点全部选中」
- **状态栏入口**：显示 `已打开/总数 · 集合名`，点击弹出完整菜单
- **数据落盘**：`<窗口根>/.vscode/git-xlx.json`，可直接手改

## 命令

| 命令 | 位置 |
| --- | --- |
| `Git XLX: 保存当前为集合` | 栏标题栏 |
| `Git XLX: 全部取消选中` | 栏标题栏 |
| `Git XLX: 套用集合` | 栏标题栏 |
| `Git XLX: 扫描仓库` | 栏标题栏 `…` |
| `Git XLX: 刷新` | 栏标题栏 `…` |
| `Git XLX: 打开配置文件` | 栏标题栏 `…` |
| `Git XLX: 打开设置` | 栏标题栏 `…` |
| `Git XLX: 选中该节点全部仓库` | 分组右键 |
| `Git XLX: 取消该节点全部选中` | 分组右键 |
| `Git XLX: 打开全部仓库` | 命令面板 |
| `Git XLX: 关闭全部仓库` | 命令面板 |

## 配置

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `gitXlx.configPath` | 空 | 数据文件路径，留空即 `<窗口根>/.vscode/git-xlx.json` |
| `gitXlx.restoreOnStartup` | `true` | 启动时自动套用 `activeSet` |
| `gitXlx.alignDelay` | `5` | 仓库扫描静默多少秒后开始对齐 |
| `gitXlx.newRepoPolicy` | `keep` | 发现不在集合里的新仓库：`keep` 保持打开 / `close` 自动关闭 |
| `gitXlx.confirmBeforeClose` | `true` | 批量关闭前弹确认 |

## 数据文件

```jsonc
{
  "version": 1,
  "activeSet": "feature-a",
  "repoSets": {
    "feature-a": {
      "repos": ["/path/to/repo-1", "/path/to/repo-2"],
      "updatedAt": "2026-11-12T12:40:00+08:00"
    }
  },
  "known": ["/path/to/repo-3"]
}
```

`repoSets` 是集合清单，`activeSet` 是最近套用的集合，`known` 是见过但可能已关闭的
仓库——它保证清单完整，关掉的仓库不会从栏里消失。

## 相关链接

- 源码仓库：<https://github.com/xiao-linxin/vscode-git-xlx>
- 问题反馈：<https://github.com/xiao-linxin/vscode-git-xlx/issues>
- VS Code 官方市场：<https://marketplace.visualstudio.com/items?itemName=xiaolinxin.git-xlx>
- Open VSX：<https://open-vsx.org/extension/xiaolinxin/git-xlx>

## License

MIT