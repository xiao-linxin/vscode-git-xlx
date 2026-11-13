import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const NS = 'gitXlx';
const STATE_NAME = 'git-xlx.json';

interface RepoSet {
  repos: string[];
  updatedAt: string;
}

interface State {
  version: number;
  activeSet: string;
  repoSets: Record<string, RepoSet>;
  known: string[];
}

let ch: vscode.OutputChannel;
let provider: RepoProvider;
let tree: vscode.TreeView<vscode.TreeItem>;
let status: vscode.StatusBarItem;
let stateFile = '';
let openMap = new Map<string, any>();
let alignTimer: NodeJS.Timeout | undefined;
let alignedOnce = false;
let busy = false;

function log(msg: string): void {
  ch.appendLine(msg);
}

function conf(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(NS);
}

/* ------------------------------------------------------------------ 状态文件 */

function resolveStateFile(): string {
  const raw = (conf().get<string>('configPath', '') || '').trim();
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (raw) {
    const first = folders[0]?.uri.fsPath ?? '';
    const p = raw.replace(/^~/, os.homedir()).replace(/\$\{workspaceFolder\}/g, first);
    return path.resolve(p);
  }
  if (folders.length) {
    return path.join(folders[0].uri.fsPath, '.vscode', STATE_NAME);
  }
  return path.join(os.homedir(), '.config', 'git-xlx', STATE_NAME);
}

function emptyState(): State {
  return { version: 1, activeSet: '', repoSets: {}, known: [] };
}

function loadState(): State {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return {
      version: 1,
      activeSet: typeof s.activeSet === 'string' ? s.activeSet : '',
      repoSets: s.repoSets && typeof s.repoSets === 'object' ? s.repoSets : {},
      known: Array.isArray(s.known) ? s.known : [],
    };
  } catch {
    return emptyState();
  }
}

function saveState(s: State): void {
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, `${JSON.stringify(s, null, 2)}\n`, 'utf8');
    log(`[state] 写入 ${stateFile}`);
  } catch (e: any) {
    log(`[state] 写入失败：${e?.message ?? e}`);
    void vscode.window.showErrorMessage(`Git XLX：无法写入 ${stateFile}（${e?.message ?? e}）`);
  }
}

/* ------------------------------------------------------------------ git API */

interface GitApiLike {
  repositories: any[];
  onDidOpenRepository: vscode.Event<any>;
  onDidCloseRepository: vscode.Event<any>;
}

async function gitApi(): Promise<GitApiLike | undefined> {
  const ext = vscode.extensions.getExtension('vscode.git');
  if (!ext) {
    log('[git] 找不到内置 git 扩展');
    return undefined;
  }
  if (!ext.isActive) {
    try {
      await ext.activate();
    } catch (e: any) {
      log(`[git] 激活失败：${e?.message ?? e}`);
      return undefined;
    }
  }
  const api = ext.exports?.getAPI ? ext.exports.getAPI(1) : ext.exports;
  return api as GitApiLike | undefined;
}

function norm(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

async function refreshOpen(): Promise<void> {
  const api = await gitApi();
  openMap = new Map<string, any>();
  for (const r of api?.repositories ?? []) {
    const p = r?.rootUri?.fsPath;
    if (p) {
      openMap.set(norm(p), r);
    }
  }
}

function knownPaths(): string[] {
  const st = loadState();
  const set = new Map<string, string>();
  for (const p of st.known) {
    set.set(norm(p), p);
  }
  for (const p of openMap.keys()) {
    if (!set.has(p)) {
      set.set(p, p);
    }
  }
  return [...set.values()].sort();
}

function mergeKnown(): void {
  const st = loadState();
  const seen = new Map<string, string>();
  for (const p of st.known) {
    seen.set(norm(p), p);
  }
  let added = 0;
  for (const p of openMap.keys()) {
    if (!seen.has(p)) {
      seen.set(p, p);
      added++;
    }
  }
  if (added) {
    st.known = [...seen.values()].sort();
    saveState(st);
    log(`[known] 新增 ${added} 个仓库`);
  }
}

/* ------------------------------------------------------------------ 关闭/打开 */

async function openRepo(repoPath: string): Promise<void> {
  if (!fs.existsSync(path.join(repoPath, '.git'))) {
    log(`[skip] 不是仓库：${repoPath}`);
    return;
  }
  try {
    await vscode.commands.executeCommand('git.openRepository', repoPath);
    log(`[open] ${repoPath}`);
  } catch (e: any) {
    log(`[open 失败] ${repoPath}：${e?.message ?? e}`);
  }
}

async function closeRepo(repoPath: string): Promise<void> {
  const repo = openMap.get(norm(repoPath));
  if (!repo) {
    return;
  }
  try {
    await vscode.commands.executeCommand('git.close', repo);
    log(`[close] ${repoPath}`);
  } catch (e: any) {
    log(`[close 失败] ${repoPath}：${e?.message ?? e}`);
  }
}

async function align(target: Set<string>, reason: string, needConfirm: boolean): Promise<void> {
  if (busy) {
    log(`[align:${reason}] 上一次对齐未结束，跳过`);
    return;
  }
  busy = true;
  try {
    await refreshOpen();
    const toClose = [...openMap.keys()].filter((p) => !target.has(p));
    const toOpen = [...target].filter((p) => !openMap.has(p));
    log(`[align:${reason}] 需打开 ${toOpen.length} 个 / 需关闭 ${toClose.length} 个`);

    if (needConfirm && toClose.length > 3 && conf().get<boolean>('confirmBeforeClose', true)) {
      const ok = await vscode.window.showWarningMessage(
        `将关闭 ${toClose.length} 个不在集合里的仓库，继续？`,
        { modal: true },
        '继续',
      );
      if (ok !== '继续') {
        log(`[align:${reason}] 用户取消`);
        return;
      }
    }

    for (const p of toClose) {
      await closeRepo(p);
    }
    for (const p of toOpen) {
      await openRepo(p);
    }
    await refreshOpen();
    mergeKnown();
    provider.refresh();
    updateStatus();
    log(`[align:${reason}] 完成，当前打开 ${openMap.size} 个`);
  } finally {
    busy = false;
  }
}

/* ------------------------------------------------------------------ 扫描 */

function scanDir(root: string, maxDepth: number, out: string[]): void {
  const walk = (dir: string, depth: number): void => {
    if (out.length > 3000) {
      return;
    }
    if (fs.existsSync(path.join(dir, '.git'))) {
      out.push(dir);
      return;
    }
    if (depth >= maxDepth) {
      return;
    }
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) {
        continue;
      }
      if (e.name === 'node_modules' || e.name.startsWith('.')) {
        continue;
      }
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
}

function scanWorkspace(): string[] {
  const out: string[] = [];
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    scanDir(f.uri.fsPath, 2, out);
  }
  return out;
}

/* ------------------------------------------------------------------ 视图 */

/** 组名后缀归一：go_service.worktrees / go_service.wt / go_service-worktrees → go_service */
const GROUP_SUFFIXES = ['.worktrees', '-worktrees', '.wt'];

function groupOf(p: string): { key: string; label: string } {
  const parts = p.split(path.sep).filter(Boolean);
  let baseDir: string;
  let raw: string;
  if ((parts[0] === 'www' || parts[0] === 'home') && parts.length >= 3) {
    baseDir = `/${parts[0]}/${parts[1]}`;
    raw = parts[2];
  } else {
    baseDir = path.dirname(path.dirname(p));
    raw = path.basename(path.dirname(p));
  }
  let name = raw;
  const lower = raw.toLowerCase();
  for (const sfx of GROUP_SUFFIXES) {
    if (lower.endsWith(sfx) && raw.length > sfx.length) {
      name = raw.slice(0, raw.length - sfx.length);
      break;
    }
  }
  return { key: path.join(baseDir, name), label: name };
}

class RepoItem extends vscode.TreeItem {
  readonly kind = 'repo';

  constructor(readonly repoPath: string, readonly checked: boolean, branch: string, label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = `repo:${repoPath}`;
    this.contextValue = 'gitXlx.repo';
    this.tooltip = `${repoPath}\n${checked ? '已打开' : '已关闭'}${branch ? ` · ${branch}` : ''}`;
    this.description = checked ? branch : `${branch ? `${branch} · ` : ''}已关闭`;
    this.checkboxState = checked ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
    this.iconPath = new vscode.ThemeIcon(checked ? 'repo' : 'repo-forked');
    this.resourceUri = vscode.Uri.file(repoPath);
  }
}

class GroupItem extends vscode.TreeItem {
  constructor(readonly groupKey: string, readonly children: RepoItem[], label: string) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `group:${groupKey}`;
    this.contextValue = 'gitXlx.group';
    const checked = children.filter((c) => c.checked).length;
    this.description = `${checked}/${children.length}`;
    this.iconPath = new vscode.ThemeIcon(checked > 0 ? 'folder-active' : 'folder');
  }
}

class RepoProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(el: vscode.TreeItem): vscode.TreeItem {
    return el;
  }

  getChildren(el?: vscode.TreeItem): vscode.TreeItem[] {
    if (el instanceof GroupItem) {
      return el.children;
    }
    const buckets = new Map<string, { label: string; items: RepoItem[] }>();
    for (const p of knownPaths()) {
      const g = groupOf(p);
      const repo = openMap.get(norm(p));
      const branch = repo?.state?.HEAD?.name ?? '';
      const label = path.relative(path.dirname(g.key), p) || path.basename(p);
      const item = new RepoItem(p, !!repo, branch, label);
      const bucket = buckets.get(g.key) ?? { label: g.label, items: [] };
      bucket.items.push(item);
      buckets.set(g.key, bucket);
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, b]) => new GroupItem(key, b.items.sort((x, y) => x.label!.toString().localeCompare(y.label!.toString())), b.label));
  }
}

function updateStatus(): void {
  const total = knownPaths().length;
  const st = loadState();
  const active = st.activeSet ? ` · ${st.activeSet}` : '';
  status.text = `$(bookmark) ${openMap.size}/${total}${active}`;
  status.tooltip = `Git XLX 仓库集：已打开 ${openMap.size} / 共 ${total}\n点击查看菜单`;
}

/* ------------------------------------------------------------------ 启动对齐 */

function scheduleAlign(): void {
  if (alignedOnce) {
    return;
  }
  if (alignTimer) {
    clearTimeout(alignTimer);
  }
  const secs = Math.max(1, conf().get<number>('alignDelay', 5));
  alignTimer = setTimeout(() => {
    void runStartupAlign();
  }, secs * 1000);
}

async function runStartupAlign(): Promise<void> {
  if (alignedOnce) {
    return;
  }
  alignedOnce = true;
  await refreshOpen();
  mergeKnown();
  provider.refresh();
  updateStatus();

  const st = loadState();
  const entry = st.activeSet ? st.repoSets[st.activeSet] : undefined;
  if (!entry) {
    log('[startup] 没有 activeSet，跳过自动对齐');
    return;
  }
  if (!conf().get<boolean>('restoreOnStartup', true)) {
    log('[startup] restoreOnStartup=false，跳过');
    return;
  }
  const target = new Set(entry.repos.map(norm));
  await align(target, `startup:${st.activeSet}`, false);
}

/* ------------------------------------------------------------------ 命令 */

async function cmdSave(): Promise<void> {
  await refreshOpen();
  const repos = [...openMap.keys()].sort();
  if (!repos.length) {
    void vscode.window.showWarningMessage('当前没有打开的仓库，无法保存。');
    return;
  }
  const st = loadState();
  const name = await vscode.window.showInputBox({
    title: '保存仓库集',
    prompt: `当前打开了 ${repos.length} 个仓库，给这套集合起个名字`,
    value: st.activeSet || '',
    validateInput: (v) => (v.trim() ? undefined : '名字不能为空'),
  });
  if (!name) {
    return;
  }
  const key = name.trim();
  st.repoSets[key] = { repos, updatedAt: new Date().toISOString() };
  st.activeSet = key;
  saveState(st);
  provider.refresh();
  updateStatus();
  void vscode.window.showInformationMessage(`已保存仓库集「${key}」（${repos.length} 个仓库）`);
}

async function cmdApply(): Promise<void> {
  const st = loadState();
  const names = Object.keys(st.repoSets);
  if (!names.length) {
    void vscode.window.showWarningMessage('还没有保存过任何仓库集。');
    return;
  }
  const pick = await vscode.window.showQuickPick(
    names
      .sort()
      .map((n) => ({
        label: n,
        description: `${st.repoSets[n].repos.length} 个仓库`,
        detail: st.repoSets[n].repos.join('  '),
        picked: n === st.activeSet,
      })),
    { title: '套用仓库集', placeHolder: '选择要套用的集合' },
  );
  if (!pick) {
    return;
  }
  st.activeSet = pick.label;
  saveState(st);
  await align(new Set(st.repoSets[pick.label].repos.map(norm)), `apply:${pick.label}`, true);
  updateStatus();
}

async function cmdOpenAll(): Promise<void> {
  await refreshOpen();
  const all = knownPaths();
  await align(new Set(all.map(norm)), 'openAll', false);
}

async function cmdCloseAll(): Promise<void> {
  const ok = conf().get<boolean>('confirmBeforeClose', true)
    ? await vscode.window.showWarningMessage(
        `将关闭全部 ${openMap.size} 个仓库（只保留\"打开全部\"可恢复），继续？`,
        { modal: true },
        '继续',
      )
    : '继续';
  if (ok !== '继续') {
    return;
  }
  await align(new Set<string>(), 'closeAll', false);
}

function pathsUnder(item?: vscode.TreeItem): string[] {
  if (item instanceof GroupItem) {
    return item.children.map((c) => c.repoPath);
  }
  if (item instanceof RepoItem) {
    return [item.repoPath];
  }
  return [];
}

async function cmdGroupCloseAll(item?: vscode.TreeItem): Promise<void> {
  await refreshOpen();
  const paths = pathsUnder(item);
  const targets = paths.filter((p) => openMap.has(norm(p)));
  if (!targets.length) {
    void vscode.window.showInformationMessage('该节点下没有已打开的仓库。');
    return;
  }
  if (conf().get<boolean>('confirmBeforeClose', true) && targets.length > 1) {
    const ok = await vscode.window.showWarningMessage(
      `将取消「${item?.label ?? '该节点'}」下 ${targets.length} 个仓库的选中，继续？`,
      { modal: true },
      '继续',
    );
    if (ok !== '继续') {
      return;
    }
  }
  for (const p of targets) {
    await closeRepo(p);
  }
  await refreshOpen();
  provider.refresh();
  updateStatus();
}

async function cmdGroupOpenAll(item?: vscode.TreeItem): Promise<void> {
  await refreshOpen();
  const paths = pathsUnder(item);
  for (const p of paths) {
    if (!openMap.has(norm(p))) {
      await openRepo(p);
    }
  }
  await refreshOpen();
  provider.refresh();
  updateStatus();
}

async function cmdScan(): Promise<void> {
  const found = scanWorkspace();
  log(`[scan] 工作区内发现 ${found.length} 个仓库目录`);
  const st = loadState();
  const seen = new Map<string, string>();
  for (const p of st.known) {
    seen.set(norm(p), p);
  }
  let added = 0;
  for (const p of found) {
    const n = norm(p);
    if (!seen.has(n)) {
      seen.set(n, p);
      added++;
    }
  }
  st.known = [...seen.values()].sort();
  saveState(st);
  provider.refresh();
  updateStatus();
  void vscode.window.showInformationMessage(`扫描完成：发现 ${found.length} 个，新增 ${added} 个（共 ${st.known.length} 个已知仓库）`);
}

async function cmdRefresh(): Promise<void> {
  await refreshOpen();
  provider.refresh();
  updateStatus();
}

async function cmdOpenConfig(): Promise<void> {
  if (!fs.existsSync(stateFile)) {
    saveState(loadState());
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(stateFile));
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function cmdOpenSettings(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:xiaolinxin.git-xlx');
}

async function cmdMenu(): Promise<void> {
  const st = loadState();
  const items = [
    { label: '$(bookmark) 保存当前为集合', cmd: 'gitXlx.save' },
    { label: '$(checklist) 套用集合', cmd: 'gitXlx.apply' },
    { label: '$(expand-all) 打开全部仓库', cmd: 'gitXlx.openAll' },
    { label: '$(collapse-all) 关闭全部仓库', cmd: 'gitXlx.closeAll' },
    { label: '$(search) 扫描仓库', cmd: 'gitXlx.scan' },
    { label: '$(json) 打开配置文件', cmd: 'gitXlx.openConfig' },
    { label: '$(gear) 打开设置', cmd: 'gitXlx.openSettings' },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title: `Git XLX · 已打开 ${openMap.size} · 当前集合 ${st.activeSet || '（未设置）'}`,
  });
  if (pick) {
    await vscode.commands.executeCommand(pick.cmd);
  }
}

/* ------------------------------------------------------------------ 激活 */

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  ch = vscode.window.createOutputChannel('Git XLX', { log: true });
  ctx.subscriptions.push(ch);
  ch.appendLine(`激活 ${ctx.extension.packageJSON.version} · app=${vscode.env.appName} · remote=${vscode.env.remoteName ?? '-'}`);

  stateFile = resolveStateFile();
  ch.appendLine(`数据文件：${stateFile}`);

  provider = new RepoProvider();
  tree = vscode.window.createTreeView('gitXlx.repoSets', { treeDataProvider: provider, showCollapseAll: true });
  ctx.subscriptions.push(tree);

  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 88);
  status.command = 'gitXlx.menu';
  status.show();
  ctx.subscriptions.push(status);

  await refreshOpen();

  tree.onDidChangeCheckboxState(async (e) => {
    for (const [item, state] of e.items) {
      if (!(item instanceof RepoItem)) {
        continue;
      }
      if (state === vscode.TreeItemCheckboxState.Checked) {
        await openRepo(item.repoPath);
      } else {
        await closeRepo(item.repoPath);
      }
    }
    await refreshOpen();
    mergeKnown();
    provider.refresh();
    updateStatus();
  });

  ctx.subscriptions.push(
    vscode.commands.registerCommand('gitXlx.save', cmdSave),
    vscode.commands.registerCommand('gitXlx.apply', cmdApply),
    vscode.commands.registerCommand('gitXlx.openAll', cmdOpenAll),
    vscode.commands.registerCommand('gitXlx.closeAll', cmdCloseAll),
    vscode.commands.registerCommand('gitXlx.scan', cmdScan),
    vscode.commands.registerCommand('gitXlx.refresh', cmdRefresh),
    vscode.commands.registerCommand('gitXlx.openConfig', cmdOpenConfig),
    vscode.commands.registerCommand('gitXlx.openSettings', cmdOpenSettings),
    vscode.commands.registerCommand('gitXlx.menu', cmdMenu),
    vscode.commands.registerCommand('gitXlx.groupCloseAll', cmdGroupCloseAll),
    vscode.commands.registerCommand('gitXlx.groupOpenAll', cmdGroupOpenAll),
  );

  const api = await gitApi();
  if (api) {
    ctx.subscriptions.push(
      api.onDidOpenRepository((repo: any) => {
        void (async () => {
          await refreshOpen();
          provider.refresh();
          updateStatus();
          if (!alignedOnce) {
            scheduleAlign();
            return;
          }
          const st = loadState();
          const entry = st.activeSet ? st.repoSets[st.activeSet] : undefined;
          const p = repo?.rootUri?.fsPath;
          if (!entry || !p || conf().get<string>('newRepoPolicy', 'keep') !== 'close') {
            return;
          }
          if (!new Set(entry.repos.map(norm)).has(norm(p))) {
            log(`[policy] 新仓库不在集合里，自动关闭 ${p}`);
            await closeRepo(p);
            await refreshOpen();
            provider.refresh();
            updateStatus();
          }
        })();
      }),
      api.onDidCloseRepository(() => {
        void (async () => {
          await refreshOpen();
          provider.refresh();
          updateStatus();
        })();
      }),
    );
  }

  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(NS)) {
        stateFile = resolveStateFile();
        log(`[config] 数据文件改为 ${stateFile}`);
        provider.refresh();
        updateStatus();
      }
    }),
  );

  provider.refresh();
  updateStatus();
  scheduleAlign();
  ch.appendLine('视图与命令已就绪');
}

export function deactivate(): void {
  if (alignTimer) {
    clearTimeout(alignTimer);
  }
}