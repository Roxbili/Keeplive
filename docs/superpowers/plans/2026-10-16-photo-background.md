# 照片后台恢复与无窗口启动计划

> 使用 superpowers:executing-plans 在当前会话执行，按 TDD 验证。

**目标：**按用户最新指示恢复本机照片服务，照片后台只有一个计划任务入口，启动全程不分配终端窗口。

**架构：**复用已验证的 GUI 启动器；照片进程使用 CreateNoWindow 和异步文件流记录日志，保持互斥锁、Job 回收与异常重启。SSH 隧道继续独立运行。

**技术栈：**Windows PowerShell 5.1、.NET Process、Node.js 测试。

**需求来源：**用户明确授权恢复照片后台并改成单一入口、无终端窗口启动。

## 约束与验证重点

- 保留照片、数据库、身份验证配置；飞书保持移除。
- Keeplive 目录不是 Git 仓库，保留本机备份，不初始化仓库或提交无关仓库。
- 覆盖无控制台、带空格路径、持续日志、异常重启、防重复和子进程回收。
- 回验本机 3210 与远端隧道 HTTP；不把未登录检查称为用户照片浏览验证。

## 执行步骤

- [x] 在 tests/windows-autostart.test.js 添加真实控制台探针及运行期间日志断言，先观察旧实现失败。
- [x] run-keeplive.ps1 改成 CreateNoWindow 并将 stdout/stderr 异步复制到文件，避免长期内存缓存；install-autostart.ps1 复用 GUI 启动器。
- [x] 运行目标测试及 npm test，完成独立审查。
- [x] 安装唯一照片后台计划任务，验证进程、端口、HTTP 和启动入口，记录结果。

## 验证记录

- 原生探针先复现旧实现窗口句柄 133986；改用 CreateNoWindow 后为 0，运行期间 stdout/stderr 文件及时写入。
- 独立审查发现原生后代持有日志管道时阻塞重启。原生探针复现超时 RED；将 Job 回收移到等待输出 EOF 之前后 GREEN，后代已回收，父进程异常后成功重启。
- Node 真实进程检查采用 GetConsoleWindow，而非仅依据 AttachConsole 成功与否；后者不能证明存在窗口。真实 Node 和监督 PowerShell 窗口句柄均为 0。
- 最终 npm test：73 通过、0 失败、0 跳过。覆盖异常重启、防重复、后代回收、日志流和无窗口。
- 当前照片后台一个计划任务、一个 Node；SSH 一个独立任务和一个隧道进程。注册表、启动文件夹和 Windows 服务未发现额外 Keeplive 入口；飞书入口与进程均为 0。
- 重复启动照片任务与 GUI 启动器仍保留同一 Node。更新后停止任务确认旧进程已回收，再启动最终脚本成功。
- 本机网页 HTTP 200；本机和服务器经 13210 隧道读取账号状态均成功，setup=false。未登录用户账号浏览私人照片。
- 备份与测试证据：C:/Users/Fanding/AppData/Local/Codex/maintenance/keeplive-photo-restore-20261016-003113。
