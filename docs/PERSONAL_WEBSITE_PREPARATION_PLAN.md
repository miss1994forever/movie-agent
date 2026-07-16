# Movie Rec 个人网站展示前修改计划

## 实施状态（2026-07-16）

本轮已经完成：

- Demo Mode、虚构数据 Provider、独立 demo SQLite；
- 后端配置写入、Letterboxd 读取和写入能力开关；
- Demo Mode 前端敏感入口隐藏，后端直调返回 403；
- Cookie 必须经过远程页面确认后才视为登录成功；
- 前端 GET 超时与有限重试、推荐任务瞬时故障重试；
- 搜索正/负缓存 TTL 和空观看记录处理；
- MCP 默认仅监听 loopback，可选 API Key 校验；
- README、MIT License、第三方声明、架构/可靠性/隐私文档；
- 可真实执行的 demo 回归测试与外部 integration test 隔离。

仍未完成：

- Letterboxd 导出文件 Provider；
- 统一的结构化 `ok/empty/degraded/error` 工具结果；
- 运行中推荐任务的 SQLite 持久化与重启后 `interrupted` 状态；
- 个人网站所需的脱敏截图、架构图成图和演示视频；
- 公开部署、限流、预算告警和部署地区合规确认。

当前验证结果：`pytest -q` 为 8 passed、4 skipped；跳过项均为需要显式开启和真实凭据的外部模型集成测试。Node 语法检查和 Vue production build 通过。

## 1. 目标与边界

本计划的目标是把 Movie Rec 整理成一个适合放入个人网站和公开 GitHub 的个人兴趣项目案例，主要面向软件招聘者、技术面试官和其他开发者。

推荐的公开形态是：

- 个人网站展示项目介绍、界面截图、架构图、关键技术决策和局限；
- GitHub 仓库提供可检查的源码、安装说明和测试证据；
- 如需在线体验，只提供使用示例数据的只读演示；
- 不向访客收集 Letterboxd 密码或 Cookie；
- 不让公开服务抓取 Letterboxd，也不允许访客通过服务器修改真实 Letterboxd 账号。

这不是一份“直接把当前本地应用部署成多用户 SaaS”的计划。当前 Letterboxd 条款禁止未经授权的自动抓取，而其 API 申请页明确表示暂不向推荐或 LLM/GPT 项目提供访问权限。因此，公开展示应和真实 Letterboxd 集成解耦。

## 2. 完成标准

当以下条件全部满足时，可以把项目加入个人网站：

- 仓库历史和当前文件中没有真实 API Key、密码、Cookie、个人导出数据或本地数据库；
- README 在首屏说明项目解决的问题、个人贡献、当前状态和运行边界；
- 项目可以使用示例数据完成核心界面演示，不依赖真实 Letterboxd 登录；
- 公开演示不暴露配置修改、账号写入、历史数据和 MCP 管理接口；
- 至少有一张真实界面截图、一张架构图和一个可复现的测试或构建结果；
- 自动化测试不再全部被跳过，前端构建和关键后端测试可执行；
- 项目页面明确写出它是个人实验性原型，不是 Letterboxd 官方产品，也不是生产级推荐系统；
- 许可证、第三方数据来源和品牌归属说明完整。

## 3. 修改顺序总览

| 阶段 | 目标 | 是否阻塞公开展示 |
|---|---|---|
| P0 | 清理秘密和法律/品牌风险 | 是 |
| P1 | 建立安全的展示模式 | 是 |
| P2 | 修复最明显的可靠性问题 | 是 |
| P3 | 补测试、文档和技术证据 | 是 |
| P4 | 制作个人网站项目内容 | 是 |
| P5 | 可选的公开 Demo 与后续维护 | 否 |

## 4. P0：公开仓库安全与合规清理

### 4.1 检查秘密及 Git 历史

1. 检查 `.env`、`.env.bak`、SQLite、缓存快照、保存的 HTML、截图和日志是否包含：
   - DashScope/TMDB API Key；
   - Letterboxd 用户名、密码、Cookie、CSRF token；
   - 真实观影记录和个人口味画像。
2. 不只检查当前工作树，也检查 Git 历史。若秘密曾经提交过，应先吊销并轮换密钥，再使用合适的历史清理工具处理。
3. 保留 `.gitignore` 中对 `.env`、数据库、日志和缓存的忽略规则，并补充 MCP 生成的资料快照、浏览器 profile 和保存 HTML 的实际路径。
4. 在 CI 中增加秘密扫描，避免以后重新提交。

验收：从一份全新 clone 中搜索常见密钥前缀、`LETTERBOXD_COOKIE` 实值和 session 标记，不得到任何真实凭据。

### 4.2 修改公开配置模板

修改 `config/.env.example`：

- 不再把用户名/密码标成推荐方案；
- 把真实账号集成标记为“仅本地开发、不要部署到公开服务器”；
- 为展示模式增加 `MOVIE_REC_DEMO_MODE=true`；
- 默认关闭 Letterboxd 写操作和浏览器登录；
- 默认关闭详细 traceback 和 crew verbose 日志；
- 说明 TMDB Key 只能放在后端，不可打包进前端。

验收：用户仅复制示例配置并启动展示模式时，不会被要求输入 Letterboxd 凭据。

### 4.3 增加许可证与归属声明

1. 选择并加入开源许可证；如果暂时不希望他人复用源码，也要明确保留权利，不能让许可状态含糊。
2. 在 README 加入：
   - “Unofficial project; not affiliated with or endorsed by Letterboxd”；
   - Letterboxd 名称和标识归其权利人所有；
   - 电影元数据和海报的实际来源及相应署名；
   - 不包含、也不授权运行公开 Letterboxd scraper。
3. 个人网站尽量使用自己的项目视觉，不把 Letterboxd Logo 当作项目 Logo。

验收：访问者不会误以为项目是 Letterboxd 官方合作或官方 API 客户端。

## 5. P1：建立安全的展示模式

### 5.1 将数据入口抽象为 Provider

把“口味数据从哪里来”从推荐流程中拆出统一接口，例如：

```text
TasteDataProvider
├── DemoTasteDataProvider       # 仓库内匿名示例数据
├── ExportTasteDataProvider     # 用户本地上传的 Letterboxd 导出文件
└── LocalLetterboxdProvider     # 仅本地开发，可选且默认关闭
```

推荐流程只接收标准化后的影片、评分、日记和 watchlist 数据，不直接知道 Cookie、Playwright 或网页抓取细节。

建议新增：

- `src/movie_rec/providers/base.py`
- `src/movie_rec/providers/demo.py`
- `src/movie_rec/providers/letterboxd_export.py`
- `examples/demo_profile/` 下的虚构或充分匿名化数据

验收：运行核心推荐流程时，可以完全不启动 `Letterboxd-MCP`。

### 5.2 增加 Demo Mode

展示模式应满足：

- 使用固定、可公开的示例观影数据；
- 禁用所有 Letterboxd 写工具；
- 隐藏 Settings 中的密码、Cookie 和服务器 `.env` 编辑功能；
- 隐藏“点赞、评分、写评论、加入 watchlist”等真实账号按钮，或替换为纯界面预览；
- 推荐结果使用自己的数据库或 TMDB 元数据，并只生成 Letterboxd 普通外链；
- 页面醒目标注“Demo data / No Letterboxd account connected”。

建议在后端设置中集中定义能力开关，而不是只依靠前端隐藏：

```text
demo_mode
allow_config_write
allow_letterboxd_read
allow_letterboxd_write
```

所有敏感 API 必须在后端检查开关并拒绝调用。

验收：即使直接使用 curl 调用写入和配置接口，展示模式也返回 403，且不会启动 MCP 或读取 `.env` 中的 Letterboxd 凭据。

### 5.3 为导出文件设计本地优先流程

如果希望展示“根据自己的 Letterboxd 历史推荐”，优先支持用户主动导入自己的 Letterboxd 导出文件：

1. 在浏览器或本地后端解析导出文件；
2. 展示即将使用的数据类型和数量；
3. 获得明确同意后再生成口味画像；
4. 默认在会话结束后删除原始文件；
5. 提供删除口味画像和历史记录的入口；
6. 清楚说明哪些数据会发送给 DashScope。

第一版建议只做本地导入，不把用户数据保存到公共服务器。

## 6. P2：修复最明显的可靠性问题

### 6.1 修复 Cookie 失效判断

当前逻辑看到 session 标记 Cookie 后会先设置 `isLoggedIn = true`，但远程验证失败时没有可靠地重置状态。

修改要求：

1. Cookie 标记只表示“存在候选会话”，不表示已认证；
2. 必须通过主页、`/me/` 或其他明确认证页面确认用户名；
3. 验证失败时设置 `isLoggedIn = false`，清理失效认证 Cookie；
4. 本地模式有用户名密码时，可以再尝试一次重新登录；
5. 返回结构化错误码，例如 `AUTH_EXPIRED`、`AUTH_CHALLENGE`、`AUTH_INVALID`；
6. 为过期 Cookie、Cloudflare 页面和成功登录分别写测试。

验收：过期 Cookie 不会让 `/api/auth/check` 返回成功，也不会在无用户资料时继续假装是个性化推荐。

### 6.2 明确“无数据”和“工具失败”的区别

目前多个工具用空字典或空字符串同时表示解析失败、网络失败和真实无结果。

统一为类似结构：

```json
{
  "status": "ok | empty | degraded | error",
  "data": [],
  "source": "tmdb | export | cache | letterboxd",
  "warnings": [],
  "retryable": false
}
```

同时修复 `GetUserContextTool` 中观看记录为空时 `titles` 可能未赋值的问题。

推荐任务规则：

- `empty`：允许提示用户扩大条件或使用通用推荐；
- `degraded`：可以使用带日期的缓存，但必须在结果中说明；
- `error` 且缺少最低口味证据：停止并要求用户重试，不能把通用推荐伪装成个性化结果。

### 6.3 增加有限重试与超时

1. 对 DashScope、TMDB 和内部 API 的网络错误增加有限次数重试与指数退避；
2. 只重试超时、连接失败、429 和适当的 5xx，不重试认证失败和请求校验失败；
3. 前端 `fetch` 使用 `AbortController` 设置超时；
4. 推荐轮询遇到一次网络失败时继续有限重试，而不是立即永久停止；
5. 为每次重试记录结构化事件，但不记录秘密或完整用户画像。

验收：模拟一次临时 503 或断网后任务可以恢复；持续故障会在有限时间内停止并显示可操作的错误。

### 6.4 修正缓存策略

- 不永久缓存网络失败和“无结果”；
- 正结果和负结果使用不同 TTL；
- 缓存键包含数据源、规范化查询、年份和必要的版本信息；
- 缓存结果记录来源与生成时间；
- 展示模式使用可预测的固定缓存，真实本地模式允许刷新。

### 6.5 改善任务持久化与取消语义

作为作品集展示，最低要求是：

- 后端重启后，已完成历史仍可读取；
- 运行中任务丢失时返回明确的 `interrupted`，而不是简单 404；
- 用户可以重新提交同一请求；
- 文档诚实说明 Python 工作线程不能被强制终止。

如果不准备做真正多用户部署，不必为了作品集引入复杂队列；SQLite 中保存任务状态已足够展示工程判断。

## 7. P3：补充测试、文档和技术证据

### 7.1 先让现有测试真正运行

当前异步测试会因缺少 pytest 异步插件而全部跳过。应：

1. 加入并配置 `pytest-asyncio` 或使用现有 AnyIO 支持；
2. 把需要真实 DashScope Key 的测试标为 integration；
3. 默认测试使用 mock，不消耗真实 API 额度；
4. 为 `pytest -q`、integration test 和前端 build 分别提供命令。

### 7.2 最低测试矩阵

| 层级 | 必测场景 |
|---|---|
| Provider | 示例数据、空导出、畸形 CSV、重复影片 |
| 认证 | 有效 Cookie、过期 Cookie、缺少凭据、挑战页 |
| 工具 | 正常结果、真实空结果、超时、429、错误 JSON |
| 推荐任务 | 成功、模型失败、重试成功、取消、后端重启 |
| API 权限 | Demo Mode 下配置和写接口均返回 403 |
| 前端 | 任务轮询、错误提示、刷新恢复、空状态 |

### 7.3 重写 README 的首屏

README 开头建议依次回答：

1. 这是一个什么项目；
2. 它解决什么个人问题；
3. 你独立设计和实现了什么；
4. 当前可运行到什么程度；
5. 为什么公开版使用 Demo/导出数据而不是实时抓取；
6. 一张界面截图；
7. 快速体验命令。

不要把技术栈列表当成主要成果。应突出可检查的工程决策，例如：

- 将自然语言推荐拆成多个职责明确的 agent；
- 对模型输出进行结构化提取和文本降级解析；
- 将口味资料持久化，减少重复分析；
- 在审计后把 Letterboxd 抓取与公开展示解耦；
- 为失败状态、权限和缓存建立明确语义。

### 7.4 增加架构与决策文档

建议至少增加：

- `docs/ARCHITECTURE.md`：前端、FastAPI、推荐流程、Provider、模型和存储边界；
- `docs/RELIABILITY.md`：超时、重试、降级、缓存和任务恢复；
- `docs/SECURITY_AND_PRIVACY.md`：秘密管理、演示模式、数据生命周期；
- `docs/DECISIONS/`：记录为什么不用公开 Letterboxd scraper、为什么选择本地导入。

架构图应回答一个具体问题，不要只是装饰。推荐展示从“用户输入”到“口味数据标准化”再到“推荐生成和结果保存”的数据流，并清楚标出哪些数据可能发送给第三方模型。

## 8. P4：准备个人网站项目案例

### 8.1 项目卡片文案模板

标题：`Movie Rec — Local-first AI movie recommendation assistant`

一句话说明：

> A local-first recommendation prototype that turns a user's exported viewing history and current mood into explainable film suggestions through a multi-agent workflow.

个人贡献：

> Independently designed and implemented the FastAPI/Vue application, recommendation orchestration, data-provider boundary, local persistence, and failure-state handling.

状态：

> Personal prototype; public demo uses sample data and does not connect to or modify Letterboxd accounts.

技术标签保留 3–5 个即可，例如：`Python`、`FastAPI`、`Vue`、`crewAI`、`SQLite`。

不要声称“生产级”“正式上线”“高准确率”或“被大量用户使用”，除非之后有对应证据。

### 8.2 项目详情页结构

1. **Summary**：问题、作品、个人角色、当前成果和主截图；
2. **Context and constraints**：个人兴趣项目、Letterboxd 授权边界、模型成本和本地优先约束；
3. **Architecture**：数据 Provider、推荐 agents、FastAPI、Vue 和 SQLite；
4. **Key decisions**：
   - 为什么使用保存的 taste profile；
   - 为什么将公开 Demo 与实时 Letterboxd 登录解耦；
   - 为什么工具无结果必须区别于工具故障；
5. **Failure handling**：用一个小流程图展示 API 失败、缓存和用户提示；
6. **Evidence**：截图、测试输出、关键 API 示例和仓库链接；
7. **Limitations**：没有正式 Letterboxd API 权限、推荐质量未做用户研究、不是多用户生产系统；
8. **Next steps**：导出解析、离线评估、可解释推荐和隐私改进。

### 8.3 建议准备的视觉证据

- 首页输入 mood 和推荐结果的截图；
- Taste Profile 页面截图；
- 一张简洁架构图；
- 一张失败恢复流程图；
- 测试命令通过的终端截图或 CI badge；
- 可选：30–60 秒无旁白演示视频。

所有截图使用示例账号和示例数据，裁掉浏览器书签、系统用户名、密钥、Cookie、绝对路径和私人观影记录。

## 9. P5：可选公开 Demo

只有在 P0–P3 完成后才考虑部署。最小公开 Demo 应：

- 仅运行 Demo Provider；
- 使用服务端固定示例数据；
- 不暴露 `/api/auth/config` 和 Letterboxd 写接口；
- MCP 不随公开服务器启动，也不对公网监听；
- 有基础鉴权或严格的只读 API、请求限流、输入长度限制和成本预算；
- 使用独立的低权限模型 Key，并设置用量告警；
- 不保存访客输入，或明确说明保存期限并提供删除方式；
- 为健康检查和错误率提供最小监控；
- 在部署地区完成适用的备案、隐私和服务条款要求。

如果这些条件暂时不值得投入，使用录屏、GIF 和静态项目详情页完全足够。作品集的目标是让技术能力可检查，不要求每个项目都在线运行。

## 10. 推荐执行批次

### 批次一：可以公开仓库

- 完成秘密与 Git 历史检查；
- 修改 `.env.example`；
- 增加许可证和归属声明；
- 加入 Demo Provider 和能力开关；
- 后端彻底禁止展示模式中的配置与写操作。

### 批次二：可以作为强项目展示

- 修复 Cookie 认证判断；
- 统一工具结果和失败语义；
- 增加重试、超时和缓存 TTL；
- 让 pytest 真正执行并补关键测试；
- 重写 README，增加架构、可靠性和隐私文档。

### 批次三：可以放入个人网站

- 制作脱敏截图和架构图；
- 写项目卡片和详情页；
- 检查所有事实、链接和个人贡献表述；
- 在手机和桌面端验证图片、标题层级、可读性和外链；
- 让他人在 30 秒内回答：项目解决什么问题、你做了什么、哪里能看到证据。

### 批次四：可选在线体验

- 部署只读 Demo；
- 加限流、预算、监控和隐私说明；
- 做一次不带本地凭据的全新环境部署测试；
- 确认公开服务器无法触达真实 Letterboxd 账号。

## 11. 不建议在作品集发布前投入的工作

- 不要先做复杂多用户 Letterboxd Cookie 托管；
- 不要继续加大对 Cloudflare 或验证码的绕过能力；
- 不要在没有官方授权时把实时 Letterboxd 同步作为公开卖点；
- 不要为了“看起来像生产系统”过早引入 Kubernetes、复杂消息队列或微服务；
- 不要编造推荐准确率、用户数或性能指标；
- 不要因为没有在线 Demo 而延迟项目案例发布，静态证据和可复现仓库已经足够。

## 12. 最终发布检查表

- [ ] 仓库和历史无秘密、真实 Cookie、私人数据和本地数据库；
- [ ] README 清楚说明问题、角色、架构、状态和限制；
- [ ] Demo Mode 无需 Letterboxd 登录即可运行；
- [ ] 后端阻止所有敏感配置与账号写操作；
- [ ] 过期 Cookie 不会被判定为登录成功；
- [ ] 空结果、降级结果和错误具有不同状态；
- [ ] 默认测试真正运行，前端 production build 通过；
- [ ] License、TMDB/Letterboxd 归属和非官方声明完整；
- [ ] 截图和示例数据均已脱敏；
- [ ] 项目页至少展示一个技术取舍和一项可检查证据；
- [ ] 所有链接可在未登录状态打开；
- [ ] 没有“生产级”“准确率高”等无证据表述；
- [ ] 公开部署时已确认适用的隐私、备案和服务条款要求。
