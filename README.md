# dsh-search-hub

侧边栏 **搜索渠道管理面板**，给 DeepSeek Harness（DSH）的 `web_search` 引擎池一个可视化入口：填 API Key、多 key 轮换、可用性/额度探测、切默认引擎、回退顺序管理。

它和 `dsh-model-full` 是同一形态——不注册 search provider（`ctx.web` 的搜索 seam 仍由 `dsh-free-search` 独占），只做管理面。

## 功能特性

### 引擎管理

- **27 个搜索引擎**，按 FREE / KEY / MODEL 分组展示，状态一目了然：`已配置` / `免 key` / `缺 key` / `已禁用`。
- 每个引擎带**品牌图标**（官网 favicon，DuckDuckGo 兜底，本地缓存）+ **官网链接**（点引擎名用系统默认浏览器打开）。

### API Key 管理

- **一键填 key**：点「填写」输入后回车保存，写入宿主 credentials 服务（`~/.dsh/.credentials.yaml`），**热生效，无需重启**。
- **多 key**：每个引擎可填多个 key（逗号/换行/分号分隔），free-search key ring 自动轮换，单个 key 额度耗尽自动切下一把。
- **key 自定义名称**：每个 key 可命名，方便区分多账户（名称持久化在 `~/.dsh/dsh-search-hub/key-names.json`）。
- **编辑已有 key**：行内编辑替换，空输入不预填原值，避免误触。
- **防误触**：添加新 key 时自动收起已有 key 列表，两态互斥。
- **清除**：一键 `credentials.unset`。

### 可用性与额度探测

- `GET /probe?ids=all` 对全部引擎发最小探测请求，自动分类：`ok` / `key-invalid` / `quota` / `unreachable` / `reachable` / `no-key`。
- 支持官方额度/余额端点（Tavily usage、Firecrawl credit-usage、Kimi balance），面板显示剩余额度。

### 路由与回退

- **auto / multi 模式**：按查询语言自动选路（auto）或并发多引擎合并去重（multi）。
- **切默认引擎**：一键写入 profile 的 `cordis.patch.yml`（`provider` 字段）。
- **看回退链**：显示当前 `fallbackOrder` 顺序，可调整。
- **seam 校验**：`searchProvider` 没指向正确 provider 时顶部出黄条提示。

## 三个入口

| 入口 | 插槽 | 说明 |
|---|---|---|
| 侧边栏图标 | `sidebar.panellist` | order 2，在「插件」下面 |
| 主页面 | `main` | 点侧边栏图标打开 |
| 设置分区 | `settings.section` | order 46，设置页也能进 |

## 安装

```bash
cd ~/.dsh/profiles/desktop
# 在 package.json 的 dependencies 加：
#   "dsh-search-hub": "file:./dsh-search-hub"
# 在 dsh.profile.bundles 里加 "dsh-search-hub"（放在 dsh-free-search 之后）
node "<runtime>/pnpm.mjs" install --offline
```

重启 DSH，侧边栏出现搜索渠道面板。

## API（宿主端）

同源，挂在 `webServer` 下：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/dsh-search-hub/status` | 引擎表 + provider 绑定 + pool 配置 + 探测状态 |
| GET | `/api/dsh-search-hub/config` | pool 配置原始视图 |
| POST | `/api/dsh-search-hub/config` | `{provider?, fallbackOrder?, zhPool?, enPool?, disabledEngines?}` |
| POST | `/api/dsh-search-hub/key` | `{key: <engineId>, value}` → credentials.set |
| POST | `/api/dsh-search-hub/unkey` | `{key: <engineId>}` → credentials.unset |
| POST | `/api/dsh-search-hub/keys` | `{ref, action: add\|edit\|delete, ...}` 多 key 管理 |
| GET | `/api/dsh-search-hub/keys` | 各 ref 的 key 列表（仅 tail + 自定义名称，不回显完整值） |
| GET | `/api/dsh-search-hub/probe` | `?ids=all` 或逗号分隔引擎 id，逐引擎探测 |
| GET | `/api/dsh-search-hub/icon` | `?id=<engineId>` 引擎图标代理 |
| POST | `/api/dsh-search-hub/open-url` | `{url}` 系统默认浏览器打开官网（仅 http(s)，长度 ≤300） |

## 安全边界

- **凭据白名单**：只允许写 `ENGINES` 表里声明过的 `credRef`，其它一律拒绝。
- **写 key 不回显**：`credentialsStatus` / `/keys` 只返回布尔值或 tail，**完整 key 永远不到前端**。
- **配置写入是原子的**：先写 `.tmp-<ts>` 再 `rename`。
- **只改自己管的 5 个键**：`provider` / `fallbackOrder` / `zhPool` / `enPool` / `disabledEngines`，其它内容原样保留。
- **引擎 id 校验**：写入前按 `ENGINES` 过滤，未知 id 直接丢弃。
- **官网跳转白名单**：只放行 `http(s)://` 且长度 ≤300，`file://` / `javascript:` 一律拒绝。

## 测试

```bash
node --check index.js && node --check client.js
node test-writer.mjs     # 14 项断言，覆盖「只改一个键不能动其它键」
```

`test-writer.mjs` 把 profile 配置复制到临时目录再跑（可通过 `DSH_PROFILE` 环境变量指定真实配置路径），不会碰线上配置。

## 已知限制

- `readPoolConfig` 是手写的行级 YAML 解析，只认 `web-search-free` 条目里那 5 个键，不是通用 YAML 解析器。
- 面板每 20 秒自动刷新一次状态。
- 引擎表是硬编码的（镜像 `dsh-free-search` 的引擎池），上游新增引擎后需要同步这里。

## License

MIT
