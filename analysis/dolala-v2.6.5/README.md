# 豆啦啦无印浏览器 v2.6.5 lite：安装包重建与静态逆向报告

分析日期：2026-10-16（Asia/Shanghai）  
目标：`豆啦啦无印浏览器-v2.6.5-lite.exe`  
目标 SHA-256：`518ab91c29e0a241a5ae1813215c402621e072de7ee1b01f6e218a54bec0a4cf`

> 本报告只保留可验证的结构、接口、行为和安全结论，没有把目标程序的专有实现、脚本或图片复制进 OrbitDesk。完整文件哈希见 [`installed-files.tsv`](./installed-files.tsv)，工具链和精确取证值见 [`evidence.txt`](./evidence.txt)。

## 1. 结论摘要

1. 四个 RAR 分卷完整无损，重建出 79,009,542 字节的安装程序；RAR 测试与 Inno 负载校验均通过。
2. 安装器是 **Inno Setup 6.7.0 Unicode**，32 位安装器外壳、LZMA2 压缩、无 Authenticode 签名。
3. 正常安装位置是 `%LOCALAPPDATA%\Programs\豆啦啦浏览器`，采用最低权限的按用户安装；没有自定义注册表或 INI 写入。
4. 应用本身**不是 Electron**，不存在 ASAR、`resources.pak`、Electron 主进程或 Chromium 随包资源。它是 **x64、self-contained .NET 10 WPF 应用 + WebView2**，也可启动本机 Chrome/Edge 并通过 CDP 驱动。
5. 重建出的 `{app}` 目录有 574 个文件、251,367,268 字节（239.72 MiB）。主逻辑在 `DolaMultiBrowser.dll`；`DolaMultiBrowser.exe` 是标准 .NET apphost。
6. Dola/豆包的“2.5 + 30 秒”并不只是普通 DOM 点击：目标程序先修改页面收到的能力配置，使页面生成 15s/30s 和 Seedance 2.5 选项，然后再用页面控件选择这些选项。
7. 对 Dola，生成请求签名后不会再改 `ability_param`；它依赖修改后的页面原生状态生成并签名请求。对豆包保留一个请求体兜底，会把视频能力改成 `seedance_v2.5`、30 秒。
8. “30 秒看起来是原生选项”与“账号后端真实具备 30 秒权限”不是同一件事。静态分析没有证据证明该程序可以合法授予服务器端权限，服务端仍可拒绝请求。
9. 更新器从阿里云 OSS 获取 `latest_version.json`，支持完整包与文件级增量更新，但应用和安装器本身均未签名；更新信任主要依赖 HTTPS 以及由同一更新源提供的 SHA-256。
10. 对 OrbitDesk 最有价值的 clean-room 结论是：保留每工作区持久 profile、可见 UI 状态探测、显式 2.5/30s 选择和稳健等待逻辑；不要复制静态能力响应、私有接口、资源提取算法、指纹伪装脚本或专有资产。

## 2. 输入、重建与校验

### 2.1 输入分卷

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| `...part1.rar` | 25,165,824 | `8401c3780c0e79982ebf975c7d2e54cde2d70dbe9b7a5ce001d2d6c0b5a4184f` |
| `...part2.rar` | 25,165,824 | `3d39608e7e93f12ea0d55c6c6446045eddd2671a8fe67f4f4d8660af9aabf662` |
| `...part3.rar` | 25,165,824 | `5d3b22f23af413612c702b4a86861b11a2c39c83809628d7422d5aa6362e15a0` |
| `...part4.rar` | 3,031,108 | `17c2406db2154178db83a364254921c18787bfb3692896446d8836b16aeaa4a6` |

使用本地构建的 UnRAR 7.30 beta 1 测试，结果为 `All OK`。重建的安装器：

- 大小：79,009,542 字节
- SHA-256：`518ab91c29e0a241a5ae1813215c402621e072de7ee1b01f6e218a54bec0a4cf`
- PE：PE32/i386、Windows GUI
- Inno overlay：偏移 905,728，大小 78,103,814 字节
- PE Security Directory：空

### 2.2 提取方式

官方上游 innoextract 只声明支持到 Inno 6.3.3，因此构建了支持到 7.0.2 的 `cosmolev/innoextract` 分支，并补齐静态 Boost、liblzma、zlib、bzip2 依赖。`innoextract --test` 返回 0。

这是静态重建，不是“模拟文件列表”：所有 574 个负载文件都被实际解压并逐文件计算 SHA-256。安装器没有组件、安装类型或条件化文件组，所以重建目录就是正常安装写入 `{app}` 的完整应用负载。动态 Windows 安装没有执行的部分仅包括快捷方式创建、卸载器生成和安装结束后的启动动作。

## 3. 安装器行为

| 项目 | 结果 |
|---|---|
| 产品名 | 豆啦啦浏览器 |
| 显示版本 | 豆啦啦浏览器 v2.6.5 |
| AppId | `{{A8E3C2B1-4D5F-6A7B-8C9D-0E1F2A3B4C5D}` |
| 发布者 | Dola |
| 发布者 URL | `https://doulalala.oss-cn-qingdao.aliyuncs.com/` |
| 默认目录 | `{localappdata}\Programs\豆啦啦浏览器` |
| 开始菜单组 | 豆啦啦浏览器 |
| 权限 | `LowestPrivileges`，按用户安装 |
| 安装器最低系统 | Windows 7 SP1 |
| 压缩 | LZMA2 |
| 语言 | 简体中文，LCID 804 |
| 自定义注册表项 | 0 |
| 自定义 INI 项 | 0 |
| 组件/安装类型 | 0 / 0 |

安装器会：

- 创建程序开始菜单快捷方式；
- 创建卸载快捷方式；
- 提供“桌面快捷方式”任务，默认首次勾选；
- 安装完成后以原用户启动 `DolaMultiBrowser.exe`；静默安装时不启动；
- 将卸载信息注册为按用户安装项；
- 把卸载器放在 `{app}`。

### 安装器质量问题

- 安装器和主程序都未签名，Windows SmartScreen 与来源验证能力较弱。
- 应用只提供 x64 二进制，但 Inno 元数据没有设置 `ArchitecturesAllowed=x64`；理论上安装器可在不兼容的 32 位系统上继续安装。
- 安装器最低版本仍写 Windows 7 SP1，而应用使用 .NET 10 / 当前 WebView2；实际支持范围应明确限定 Windows 10/11 x64。

## 4. 安装目录结构

### 4.1 总览

- 文件：574
- 总字节：251,367,268（239.72 MiB）
- 扩展名分布：405 DLL、60 Python、42 JavaScript、18 PNG、11 CSS、9 JSON、6 HTML、4 XML、2 EXE、1 PDB，另有少量文本和示例媒体。

关键文件：

| 路径 | 作用 |
|---|---|
| `app/DolaMultiBrowser.exe` | x64 .NET apphost，230,912 字节 |
| `app/DolaMultiBrowser.dll` | WPF 主程序集，5,551,616 字节 |
| `app/DolaMultiBrowser.pdb` | Portable PDB，包含大量源码文档名 |
| `app/DolaMultiBrowser.runtimeconfig.json` | self-contained .NET 10.0.12 / WindowsDesktop 10.0.12 |
| `app/DolaMultiBrowser.deps.json` | 依赖图 |
| `app/Microsoft.Web.WebView2.*` | WebView2 .NET SDK 1.0.4129.50 |
| `app/WebView2Loader.dll` | WebView2 原生加载器 |
| `app/OpenCvSharp*.dll` | OpenCV/人脸处理 |
| `app/opencv_videoio_ffmpeg4100_64.dll` | OpenCV 视频 I/O |
| `app/Extensions/dola30` | Dola/豆包能力、30s、资源捕获扩展，共 21 文件 |
| `app/Extensions/cookie-editor` | Cookie 编辑器扩展，共 62 文件 |
| `app/Tools/export_jianying_draft.py` | 剪映草稿/FCP7 XML 导出封装 |
| `app/pyJianYingDraft-main` | 随包的 pyJianYingDraft 源码、测试和样例，共 76 文件 |

### 4.2 不是 Electron

没有发现以下 Electron 典型结构：

- `app.asar` / `app.asar.unpacked`
- Electron 可执行文件
- `resources.pak`、`chrome_*.pak`、`icudtl.dat`
- Node/Electron 主进程和 preload 打包

相反，证据明确指向：

- WPF：`PresentationFramework.dll`、`PresentationCore.dll`、大量 `.baml` 资源；
- WebView2：`Microsoft.Web.WebView2.Wpf.dll`、`CoreWebView2` 类型和 WebView2Loader；
- self-contained .NET：`coreclr.dll`、`hostfxr.dll`、`hostpolicy.dll`、完整框架程序集；
- 主 EXE 的字符串包含 `hostfxr_main*`、标准 apphost PDB 路径和 `DolaMultiBrowser.dll`。

因此不存在可提取的 ASAR。OrbitDesk 保持 Electron 是产品选择，不需要照搬该目标的 WPF 技术栈。

### 4.3 主程序集表面

`DolaMultiBrowser.dll` 包含：

- 1,412 个 TypeDef；
- 9,163 个 MethodDef；
- 主要命名空间：`Views`、`Services`、`Services.Automation`、`Models`、`Helpers`；
- 主程序和程序集都无 Authenticode，程序集也无 strong-name 签名；
- 随包 Portable PDB 暴露了项目结构和文件名。

代表性模块：

- `BrowserHost`：WebView2、外部 Chrome/Edge、扩展加载、导航、Cookie、代理认证；
- `InstanceManager`：实例目录、顺序、profile、指纹和代理配置；
- `AutoUpdateService`：版本检查、完整包与增量更新；
- `ResourceInterceptor`：CDP Network 监听、媒体解析；
- `DolaVideoComposerAutomation`：视频模式、模型、时长和画幅的可见 UI 选择；
- `AutomationServer`：回环 HTTP 自动化服务；
- `FingerprintInjector`：UA、时区、locale、屏幕、WebGL、canvas/audio 和 WebRTC 设置；
- `JianyingDraftExporter`：剪映/FCP7 导出；
- `DolaRemoteApiClient` / `LicenseService`：设备注册、用户、支付、激活与额度。

## 5. 浏览器与持久化模型

### 5.1 应用级数据

应用数据根目录是：

`%LOCALAPPDATA%\DolaMultiBrowser`

已确认的文件/目录名包括：

- `config.json`
- `logs`
- `update-staging`
- `storyboard-state.json`
- `workbench-state.json`
- `projects/index.json`
- `storyboard-assets`
- `asset-library`

配置模型包含工作目录、下载目录、窗口状态、浏览器引擎、自动化端口、代理开关、实例视频自动确认、自动下载、剪映目录、素材库、模型预设和远程工作台 API key 等字段。

### 5.2 实例级数据

工作目录保存：

- `instance_catalog.json`
- `instance_order.json`
- 每实例 `instance.json`
- `account_config.json`
- `fingerprint_config.json`
- `proxy_config.json`
- `webview_data_dir.txt`
- 默认 WebView2 profile 子目录名 `EBWebView`

这证明实例不是临时 iframe：每个实例有独立持久用户数据目录。外部 Chromium 模式同样使用独立 `--user-data-dir`。

默认浏览器模式为 `hybrid`，并默认允许自动化任务使用池化 Chrome。外部浏览器启动器会寻找系统 Chrome/Edge，以 `127.0.0.1` CDP 端口启动，加载 dola30 扩展，并隐藏窗口后再嵌入宿主。

## 6. 扩展、IPC 与自动化通道

### 6.1 dola30 扩展

Manifest V3 扩展名为“哆啦助手 · 30秒无水印助手”，版本 1.6.12。它声明：

- 权限：`tabs`、`scripting`、`downloads`、`storage`、`debugger`；
- host 权限：`*://*/*`；
- 内容脚本范围：Dola、豆包、千问、剪映/云雀相关站点；
- 主要脚本：能力配置、时长、分辨率、上传、媒体捕获、浮动面板和 Service Worker。

`rules.json` 中存在把 Dola skill-pack 请求重定向到静态 JSON 的规则，但 manifest 没有声明 `declarativeNetRequest` 或 `rule_resources`；按当前打包内容看，这个文件本身不会作为 DNR 规则自动生效。真正的深度替换路径在 `chrome.debugger` + CDP Fetch Service Worker 中。

### 6.2 宿主与页面之间的通道

发现以下 IPC 层：

1. **C# → 页面 JS**：`ExecuteScriptAsync` 调用 `window.setDola30s` / `window.setDoubao30s`，读取 `getDola30sStatus`。
2. **页面 MAIN world ↔ 扩展 isolated world**：DOM attribute、自定义事件和 `window.postMessage`。
3. **扩展 host bridge → Service Worker**：`chrome.runtime.sendMessage`，命令包括 debugger 嗅探开关。
4. **页面 → WebView2 宿主**：`chrome.webview.postMessage`，用于打开 Cookie 编辑器和提交 `fallback_api` 列表。
5. **外部 Chrome → C#**：CDP `Runtime.addBinding` / `Runtime.bindingCalled`。
6. **网络观察**：WebView2/Chrome CDP `Network.responseReceived` 与 `Network.loadingFinished`。
7. **本地自动化 API**：默认端口 17823，绑定 `127.0.0.1`，支持健康检查、实例启动、贴图、贴文、发送、面板生成、任务状态、等待视频和取消任务。

本地 HTTP 服务会拒绝非 `127.0.0.1`、`localhost` 或 `[::1]` 的 Host，并要求 JSON POST；但没有发现请求认证令牌。对 clean-room 产品，建议增加每次启动随机 bearer token，或改用命名管道。

### 6.3 自动 debugger 行为

扩展注释把深度嗅探描述成用户 opt-in，但当前 Service Worker 的默认值实际上是：设置不存在时返回启用。因此进入支持站点后可能自动 attach `chrome.debugger`。这会增加权限提示、兼容性和账号风控面，不建议在 OrbitDesk 中复刻。

## 7. Dola 2.5 与 30 秒机制

这是本次分析最重要的部分。

### 7.1 能力配置注入

扩展在 `document_start` 注入 `skill-pack-main.js`，观察：

- `/samantha/skill/pack`
- `/alice/slot/action_bar_v3/get_item_conf`

普通路径会复制返回 JSON，在页面读取之前加入：

- 15s、30s 时长项；
- `seedance_v2.5` 的 `supported_durations` 中的 15/30；
- action bar 的 `video-duration` 选项；
- action bar 的默认视频模型为 `seedance_v2.5`；
- 默认时长项为 30s。

深度 debugger 路径更强：Service Worker 在 CDP `Fetch.requestPaused` 阶段直接用随包静态 JSON 响应 skill-pack 请求。该静态响应声明：

- Seedance 2.5 为默认模型；
- 30s 为默认时长；
- 2.5 支持 5/10/15/30；
- 分辨率标记为 720p。

这就是“原生 30s 菜单”的来源：不是克隆一个假的 DOM 按钮，而是修改页面用于构建 React 控件的能力配置，所以页面自己渲染 30s 选项。

### 7.2 页面选择与状态确认

时长脚本使用稳定属性查找页面控件：

- `data-input-engine-actionbar-control-key="video-model"`
- `data-input-engine-actionbar-control-key="video-duration"`

它只有在视频模式可见、模型文本匹配 2.5、时长文本匹配 30s 时，才把 Dola 侧状态视为开启。C# 自动化层另有探针和点击编排：

1. 进入“视频生成”模式；
2. 打开模型菜单并选 Seedance 2.5；
3. 打开时长菜单并选 30s；
4. 可选设置画幅；
5. 轮询页面，直到模型 2.5 + 30s 同时可见。

因此，参考实现包含两层：**能力配置注入**负责让页面出现选项，**可见 UI 自动化**负责真正选中并验证。

### 7.3 发送请求

Dola 路径明确避免在已签名的 `/chat/completion` 请求上修改 `ability_param`，因为其注释记录这样会触发签名错误。它依赖页面基于被修改后的能力状态构造、签名并发送请求。

时长脚本仍可在请求发出前处理用户提示词中的时间线描述，但默认“秒数换算”和控制指令注入均关闭。对豆包，如果 skill-pack hook 未就绪，存在一个兜底路径，会遍历视频能力对象，把模型设为 `seedance_v2.5`、时长设为 30。

### 7.4 关键判定

- 这个实现使 30s **由页面原生组件渲染和选中**。
- 但选项来源经过本地响应改写，不能据此认定 Dola 后端真实向该账号授权了 30s。
- 程序没有能力在本地合法创造服务器端额度或权限；后端仍可能拒绝、降级或扣除不同额度。
- 对 OrbitDesk，符合 clean-room 与用户要求的实现应只选择 Dola 页面**本来就真实暴露**的 2.5/30s 控件；若不存在，应显示“不受支持/未授权”，不应改写 capability、subscription 或 entitlement 数据。

## 8. URL 与网络面

### 8.1 产品与更新

- `https://doulalala.oss-cn-qingdao.aliyuncs.com/latest_version.json`
- `https://doulalala.oss-cn-qingdao.aliyuncs.com/OpenCvSharpExtern.dll`
- `https://doulalala.oss-cn-qingdao.aliyuncs.com/baozang.txt`
- `https://doubao.ussn.cn`：设备、用户、支付、激活和图片额度 API
- `https://angusapi.wxw.boats/v1`：默认工作台模型 API base URL

### 8.2 浏览站点

- `https://www.dola.com/`
- `https://www.doubao.com/`
- `https://www.qianwen.com/`
- `https://xyq.jianying.com/`
- `https://jimeng.jianying.com/`
- `https://dreamina.capcut.com/`

### 8.3 主要观察端点

- Dola/豆包：`/samantha/skill/pack`
- Dola/豆包：`/alice/slot/action_bar_v3/get_item_conf`
- Dola/豆包：`/chat/completion`
- Dola/豆包：`/im/chain/single`
- 千问：`/api/v1/session/msg/list`、`/api/v1/share/info`
- 云雀/剪映：`/api/biz/v1/editor/get_package_info` 和 thread-file 列表

## 9. 更新逻辑

### 9.1 版本清单

默认更新源为阿里云 OSS 的 `latest_version.json`，也可由配置覆盖。清单模型包含：

- `Version`
- `DownloadUrl`
- `ReleaseNotes`
- `Size`
- `Sha256`
- `Mandatory`
- `FilesBaseUrl`
- `Files[]`（Path、Sha256、Size）
- lite 包 URL、大小和 SHA-256

更新器会拒绝明显属于其它产品的 feed，并检查下载 URL 是否像当前产品。

### 9.2 完整更新

- 下载 EXE 或 ZIP 到 `update-tmp`；
- 校验清单中的 SHA-256；
- 写出 `updater.cmd`；
- 等待宿主退出；
- ZIP 用系统 `tar` 解压，或直接 stage EXE；
- 替换旧 EXE，失败时回滚 `.old`；
- 重启新程序并删除更新脚本。

### 9.3 增量更新

- 比较远程文件清单和本地 SHA-256；
- 从对象池下载变化文件到 payload；
- 校验每个文件；
- updater 等待或终止占用安装目录的应用/WebView2 子进程；
- 用 `robocopy` 覆盖安装目录；
- 失败则保留旧版本并重新启动。

默认安装在用户可写的 LocalAppData；若安装目录不可写，更新器会尝试 `runas` 提权。

### 9.4 更新安全性

优点：HTTPS、完整包和文件级 SHA-256、失败回滚。  
不足：安装器、主 EXE、主 DLL均未签名；未发现对更新包做 Authenticode 或独立公钥签名验证。若 feed 与文件源一起被控制，同源 SHA-256 不能提供独立信任。OrbitDesk 应使用代码签名，并对更新 manifest 进行离线公钥签名验证。

## 10. 其它功能面

从程序集元数据、PDB 文档名、资源和扩展可确认：

- 多实例账号/工作区管理；
- WebView2 与外部 Chrome/Edge 混合引擎；
- 每实例代理、代理认证和国内网络桥；
- 指纹配置与页面注入；
- Cookie 导入/编辑和 Dola 一键登录；
- 自动化队列、实例忙碌保护、视频生成确认、状态轮询和自动下载；
- Dola/豆包/千问/云雀/即梦媒体资源观察；
- 素材库、分镜工作台、角色参考、任务队列；
- OpenCV 人脸区域/遮罩处理；
- 剪映草稿与 FCP7 XML 导出；
- 面向“字字动画”的内嵌插件桥，调用本地自动化 API 分发分镜；
- 设备注册、会员、支付、激活码和图片额度服务。

随包包含 PDB、pyJianYingDraft 测试、示例图片/音视频和文档，增加了体积并泄露内部结构；发布版应剔除不需要的开发文件。

## 11. 安全与隐私观察

1. **未签名**：安装器和主程序缺乏发布者完整性证明。
2. **广泛扩展权限**：dola30 使用 `debugger` 和 `*://*/*`，权限面过大。
3. **默认 debugger attach**：代码默认启用自动嗅探，与“主动 opt-in”的注释不完全一致。
4. **本地 API 无认证**：仅依赖 loopback 绑定、Host 检查和 JSON 请求限制。
5. **外部 CDP**：绑定 loopback，但设置 `--remote-allow-origins=*`；应随机端口并增加进程生命周期保护。
6. **配置敏感数据**：模型 API key、账号标记和大量用户配置出现在 `config.json` 模型中；应使用 Windows Credential Manager/DPAPI 保存密钥。
7. **指纹与风控**：覆盖 webdriver、UA、WebGL、canvas、audio、WebRTC 等行为可能违反站点政策并触发风控；clean-room 实现不应复制。
8. **资源提取**：目标程序包含“无水印”URL 选择与解码逻辑；这与 2.5/30s 控件选择是独立功能，不能当作 OrbitDesk 必需能力。

## 12. 对 OrbitDesk 的 clean-room 建议

### 可以借鉴的产品行为

- 每工作区独立且持久的浏览器 profile；
- 实例目录、顺序和状态的显式持久化；
- “进入视频模式 → 选择模型 → 选择时长 → 验证 UI”状态机；
- 使用稳定 `data-*` 属性优先于可变 class；
- 所有点击后轮询页面可见状态，而不是只假设点击成功；
- 自动化任务的取消、超时、忙碌锁和进度事件；
- 下载文件的来源实例、任务和时间戳关联；
- UI 拓扑：实例/账号栏、浏览器主体、自动化/资源面板、素材与分镜工作台。

### 不应复制的实现

- bundled skill-pack JSON；
- capability/action-bar 响应改写；
- 豆包请求体中的模型/时长强制改写；
- 私有 Dola/豆包接口调用或签名绕过；
- subscription/entitlement 状态修改；
- 无水印提取和专有 token 解码；
- 指纹伪装脚本；
- 原程序图标、图片、文案、XAML、JavaScript 或其它专有资产；
- 默认开启 debugger 的广权限扩展。

### 推荐的 OrbitDesk 30s 策略

1. 导航到用户配置的真实 Dola 页面；
2. 等待页面完成登录与视频模式初始化；
3. 只读取页面当前真实可见的模型、时长控件；
4. 如果页面原生显示 Seedance 2.5 和 30s，则可信点击并验证最终文本；
5. 如果页面没有 30s，明确报告“当前账号/页面未暴露 30s”，不注入选项；
6. 发送前不改写签名后的网络负载；
7. 保留人工登录和每工作区持久 session；
8. 把 DOM 适配器做成可版本化、可测试的站点驱动，不把私有响应样本打包进产品。

## 13. 分析边界

本环境没有执行 Windows GUI，也没有观察真实账号登录后的服务器响应。因此本报告不声称验证：

- 当前 Dola 线上页面是否仍使用相同 DOM/端点；
- 账号是否真正具有 2.5/30s 权限；
- 服务端是否接受被改写的能力配置；
- 动态更新源在分析时返回的具体内容；
- Windows 上 WebView2 扩展 API 与外部 Chrome 嵌入的实际稳定性。

静态安装重建、文件清单、PE/CLR 元数据、Inno 行为、扩展逻辑、IPC 表面和更新器结构均已实际提取并校验。
