# Changelog

## 0.2.4

- 市场文案修正：`description` 不再提"日常集切换"（实际是仓库集/集合切换）
- 本版**尚未发布**：待新令牌生成后执行 `./publish.sh` 同步两个市场

## 0.2.3

- 移除遗留的 `enabledApiProposals`（`contribSourceControlTitleMenu`）：当前实现已不再贡献
  `scm/repositories/title`，该声明会让 VS Code 官方市场拒绝发布
- 版本号递增，用于市场重新发布

## 0.2.2

- 发布准备：补充 `icon`、`license`、`keywords` 与 CHANGELOG
- 打包排除本机装配脚本（`*.py`）与 `.gitignore`，vsix 只保留 `package.json`、`README.md`、`out/`
- 修复 `.vscodeignore` 误排除 `README.md` 导致市场详情页空白的问题

## 0.2.1

- 标题栏新增「全部取消选中」（`$(clear-all)`），紧挨「保存当前为集合」
- 分组右键新增「选中该节点全部仓库」「取消该节点全部选中」
- 修复：`GroupItem` 缺少 `contextValue`，右键菜单不生效

## 0.2.0

- 重写为「仓库集」栏：勾选 = `git.openRepository`，取消 = `git.close`
- 保存 / 套用集合，`activeSet` 落盘 `<窗口根>/.vscode/git-xlx.json`
- 启动静默对齐（`alignDelay`），新仓库按 `newRepoPolicy` 处理
- 状态栏入口（`已打开/总数 · 集合名`）
- 5 项配置：`configPath` / `restoreOnStartup` / `alignDelay` / `newRepoPolicy` / `confirmBeforeClose`

## 0.1.0

- 首个可运行原型：按【存储库】勾选生成并切换 `.code-workspace`

## 0.0.1

- 项目初始化