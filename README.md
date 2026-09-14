# dsh-momo-learning

把 `momo-learning-mcp` 里**除 speckit 之外**的部分（墨墨学习镜像 MCP 服务 + `momo-daily-learning` Skill）打包成一个 DeepSeek Harness 可安装的插件组合包（bundle）。

安装后，Harness 里的模型会同时得到：

- 19 个 MCP 工具，名字形如 `mcp__maimemo__maimemo_auth_status`；
- 一个 Skill，名字 `momo-daily-learning`，在会话的 skill 目录里可见、可按需加载。

两者都只读本机镜像、凭证和墨墨开放 API，不修改墨墨账号。

## 每天的用法：App 负责记，这里负责考错题与讲解

墨墨 App 的正式复习会为每个词记录当天第一次作答（`FAMILIAR` / `VAGUE` / `FORGET`），这个字段已随快照落库（`today_item.first_response`）。**不重复 App 已经做完的检查**——`FAMILIAR` 的词一律不考，不论新学还是复习。

### 出题范围是整个镜像，不是今天学的词

今天刚背的词**不进候选**：短期记忆还在，考它没有检索价值。真正值得考的是「学过一段时间、已经有点忘了」的词。取词只用一条命令：

```
maimemo_list_quiz_candidates({ limit: 20 })
```

排序逻辑在 SQL 里，不在提示词里。优先级：`本地错题`（错题本未消除） > `墨墨标记顽固`（`tags` 含 `STICKING`） > `今天复习忘记` > `今天复习模糊` > `学得少`（`study_count ≤ 2`） > `间隔较久`；同层里**距上次学习越久越靠前**。三条硬规则：排除今天新学的、要求距上次学习有间隔（`minDaysSinceStudy`，默认 1 天）、今天没记住的作为间隔规则的例外保留。每个候选都带 `reason`，取词依据可追溯。

每天固定 **20 题**（上限 50），**不是 n 个词出 n 道题**。候选池通常有几百个词，只取 20；实测排序会把 `STICKING` 顽固词按距上次学习由久到近排在前面，而**今天新学的词混入数为 0**。

### 题型：五类选择题，不出对译题

真实英语考试的词汇题归纳起来只有五种形态，全部做成四选一：**语境选词**、**近义替换**、**搭配填空**、**形近辨析**、**熟词僻义**。硬约束：题干只放英文语境、**不得出现中文**（更不许写「括号里给词根，该填哪个形式」这类指令）；题干不带该词的中文释义；选项 `description` 不写释义。**不做需要语篇的题型**（成篇完形、阅读词汇题、写作）——本工具只有词表，没有语料。

`find_similar_words` 提供形近干扰项，在本地拼写里按编辑距离 / 共同前缀排序，不外调上游。**已知局限**：对单词效果好（`adapt` / `adopt`），对多词短语偏弱（`stiff price` 只能匹配到 `soaring price`），这类词改用同义或同词根角度出题。

### 一题一题弹窗

每题通过 `ask_user_question` 呈现后停下等作答，**不得把整套题一次性写进回复**。答完先判对错再给解析，**无论对错都写出该词的中文释义**——那正是把「这次蒙对了」和「真的会了」区分开的地方。

### 错题落库，日报落盘

- **答题流水不留**：只在答错时写 `quiz_mistake`（一词一行，再错只累计 `miss_count`）；答对且本来没错过的词一个字都不写；答对错题本里的词则标记 `cleared_day`。
- **日报写成文件**：`write` 到 `<工作区>/reports/momo-YYYY-MM-DD.md`，一天一个文件，内容含题数、对错、错词清单（带累计错次）与**需要加强的知识点**。
- 分工的理由：数据库管**可查询的事实**（明天优先取词要用），`reports/` 管**给人读的过程记录**（能直接打开、对比几天、git 起来）。两个都留。

## 学习记录镜像是出题缓存

本地 SQLite 里的学习记录不是历史归档，而是**出题的取数来源**：范围筛选全部走本地，出题时不再打墨墨的历史记录接口。

- **一次性全量回填**：`maimemo_backfill_study_records` 按 `next_study_date` 滑窗分页（上游单次上限 1000、无 cursor）。它拿到的就是**已加入规划的全部词**——`{as_count: true}` 给总数，分页走完给全部记录。只有在「走到的词数 == 上游总数」时才标记 `complete`，否则标 `partial` 并说明只覆盖已验证范围。
- **此后增量，且按空档自动选方式**：`maimemo_sync_today_snapshot` 存完当天词表后会刷新学习记录，`maimemo_refresh_study_records` 可以单独触发。两者都先读库里最新的 `observed_at`：
  - 当天已观测过（`gapDays <= 0`）→ 只按 `voc_ids` 刷新当天那批词，一次调用；
  - 中间有空档（`gapDays > 0`）→ **整体重走一遍计划**，因为空档期没有任何更窄的读法能保证完整。
- **为什么不能用时间窗口补空档**：上游只能用 `next_study_date` 筛日期，而**学一个词会把它推出过去的时间窗口**。若把上游当成「上次同步日至今」的窗口来查，结果会极其反直觉：窗口内到期的词数是 **0**，而窗口期实际学过的词**全部**落在窗口外——因为学完就把它们改期到未来了（实测最远排到三个月后）。新学的词同样如此，初学当天 `next_study_date` 就可能排到 89 天后，平均 12 天。另外上游没有任何按历史日期取当日词表的接口，空档期的当天词表事后补不回来。所以只有重走能证明完整；计划在 1000 词以内时它和按词刷新一样是一次调用。
- **本地出题范围**：`maimemo_query_local_records` 支持按北京时间日期范围（`last_study_date` / `first_study_date` / `next_study_date` / `add_date`）、标签（`STICKING` / `WELL_FAMILIAR`）、学习次数区间筛选与分页。它的 `completeness` 引用**全量重走的覆盖证明**而不是最近一次读——最近一次读只决定 `readRange` 与每行的 `observedAt`。

无论哪种方式，按词刷新与重走都记为分片完整性（永不 `complete`），因此**不可能**把任何词误标成「已移出计划」；刷新失败也只加警告，不影响快照本身。

`study_record` 一词一行（按 `word_id` upsert），重复同步不会产生重复行；每次同步的词集合另存在 `study_window_member`，供「移出计划」判定使用。所有日期一律存北京日历日（`YYYY-MM-DD`）。

## 两条硬约束

**不漏**：只有「走到的词数 == 上游 `as_count` 总数」时才标记 `complete`；滑窗不前进或触到页数上限会停并标 `partial` 加警告，绝不假装走完。空档期没有任何更窄的读法能保证完整，所以自动整体重走。

**不重复**：`mirror_word`（`word_id` 主键）与 `study_record`（`word_id` 主键、upsert）都是一词一行；`today_item`、`study_window_member`、`todo_entry` 均以 (批次/会话, 词) 为主键，同一批次内同一词不可能出现两次。本地查询默认只取 `plan_state='current'`。

实测（连续两轮完整操作，逐表查重）：回填走到的词数对上上游 `as_count` → `complete`；两轮后 `study_record` 与 `mirror_word` 的行数**完全不变**；同一词记录行、同一词主数据行、同一快照内重复词、同次同步重复成员、同一待办重复词——五项全为 **0**。

按设计会**按批次累积**的只有历史表：`today_item`（每次快照存当天的词表）、`study_window_member`（每次同步的词集合，供移出判定）、`mirror_sync`（每次同步一条审计行）。查询一律取当天最新批次，所以结果不会重复；要控制体积可以定期清理旧批次。

## 组成

| 路径 | 作用 |
|---|---|
| `cordis.patch.yml` | bundle 的 patch 层：插入本包自己的插件行，以及一行指向本包 MCP 服务的 `@deepseek-ai/dsh-mcp-client` |
| `index.js` | 插件本体：注册 `momo-daily-learning` Skill，并把本包路径作为 `momoLearningPaths` 服务发布出去 |
| `skills/momo-daily-learning/SKILL.md` | Skill 原文 |
| `mcp-server/` | MCP 服务本体（`src`、`dist`、`tests`、依赖）。源自另一个项目，但已按本插件做过改动：凭证服务名与数据目录改成本插件的命名，并新增了迁移脚本；这一层的边界与开发方式见 [`mcp-server/README.md`](mcp-server/README.md) |
| `verify.mjs` | 自检脚本：合成同一套组合并断言 Skill 与 19 个工具都在册 |
| `LICENSE` | MIT |

`index.js` 不 import 任何 harness 包，只用 Node 内置模块，因此包被 `pnpm link:`、tarball 还是别的方式装上都能加载。

`mcp-server/dist` 会随包提交（`tsc` 的产物），所以 `dsh plugin add` 之后**不需要构建**即可运行。`mcp-server/node_modules` 不入库：clone 之后先在包根目录跑一次 `npm run mcp:install` 装依赖。

`cordis.patch.yml` 里两行的顺序不是加载顺序，依赖关系由注入表达：第一行发布 `momoLearningPaths`，第二行声明 `inject: [momoLearningPaths]`。Loader 会等注入就绪后再求值第二行的 `!!js` 配置，所以 MCP 行拿到的是**本包真实安装路径**，而不是挂载点/profile 目录。

## 前置条件

- Node.js `>=24.13.1 <25`（`mcp-server` 的 `engines` 要求；Harness 自身运行的 Node 就是它 spawn 子进程用的解释器）。
- 一个墨墨开放平台只读访问凭证。

## 安装

从包含本目录的位置，把包加进一个 profile：

```sh
dsh plugin --profile <profile> add ./dsh-momo-learning
```

`dsh plugin` 会初始化 profile（首个 bundle 是 `@deepseek-ai/dsh-base`），用 pnpm 链接本目录，因为本包声明了 `dsh.bundle`，它会同时被追加进 `dsh.profile.bundles`。本包没有运行时 npm 依赖，所以这一步不需要联网解析依赖；`mcp-server/` 自带已安装的 `node_modules` 和已编译的 `dist/`。

先用 `--dump-config` 确认两层都合成进去了，再真正启动：

```sh
dsh --profile <profile> --dump-config   # 应出现 momo-learning 与 momo-learning-mcp 两行
dsh --profile <profile>
```

如果不想常驻，也可以用一次性 overlay：

```sh
dsh --profile <profile> --patch ./dsh-momo-learning/cordis.patch.yml
```

`--patch` 只是叠加同一份 patch 层，本包仍需先被 `dsh plugin add` 安装到 profile，行里的包名才解析得到。

## 配置墨墨访问凭证

MCP 不接受把令牌写在配置里。凭证只通过交互式命令写入操作系统安全凭证存储：

```sh
cd dsh-momo-learning
npm run credential -- set      # 交互式输入
npm run credential -- status
npm run credential -- remove
```

两个命名：`dsh.momo-learning-mcp`（凭证服务名）与 `%LOCALAPPDATA%\MomoLearning`（数据目录）。

> **从早期版本升级**：本插件的前身用的是 `codex.maimemo-learning-mcp` 与 `%LOCALAPPDATA%\CodexMomoLearning`。如果你之前配过凭证或同步过镜像，先停掉 DSH，再跑一次迁移把两者搬到新名字下：
>
> ```sh
> cd dsh-momo-learning
> npm run migrate-legacy -- --yes
> ```
>
> 它**只搬位置、不改任何账号数据**，旧条目会保留供你确认。数据库被 DSH 占用时会明确报错并提示你先停掉 DSH；凭证复制不受影响。

## 验证

在 Harness 里新开一个会话，依次确认：

1. Skill 目录里出现 `momo-daily-learning`，并能加载出《墨墨每日学习流程》正文；
2. 工具列表里出现 19 个 `mcp__maimemo__*` 工具；
3. 调用 `mcp__maimemo__maimemo_auth_status`，返回 `configured: true`；
4. 调用 `mcp__maimemo__maimemo_get_learning_overview`，返回本地镜像概况（尚未同步时会带“尚无本地学习镜像”的 warning，这是正常空状态）。

MCP 客户端在插件激活时就完成首次连接与工具发现，所以上面 3、4 步在 Harness 启动完成后即可用；Harness 启动日志里还会出现 MCP 服务自己的 stderr 诊断「墨墨学习 MCP 已通过 stdio 启动。」。

不想开会话也可以先跑自检脚本。它按 launcher 的方式合成 `dsh-base` 各层加本 bundle 层并真正启动一次，然后断言 Skill 与 19 个工具都在册：

```sh
cp <bundle>/verify.mjs "$DSH_HOME/profiles/<profile>/"
cd "$DSH_HOME/profiles/<profile>"
node verify.mjs
```

通过时打印 `PASS`，失败时逐条列出缺了哪个 Skill 或哪个工具并以退出码 1 结束。

## 卸载

```sh
dsh plugin --profile <profile> remove dsh-momo-learning
```

同时移除依赖和 patch 层。本地镜像数据与安全凭证不会被删除；要清理镜像数据，用 MCP 工具 `maimemo_clear_local_learning_data(confirm: true)`。

## 已知限制

- 第一版仍不支持写墨墨账号：加词、改复习状态、云词本都没有对应工具，Skill 也要求明确说明这一点。
- `maimemo_sync_word_supplements` 在探针未确认用户自建内容端点前固定返回 `UNSUPPORTED_CAPABILITY`。
- Skill 通过 `ctx.skills.register()` 在插件加载时注册，改 `SKILL.md` 需要重新加载插件（重启 Harness）才生效。
- 插件声明 `inject: ['skills']`，因此组合里必须有 `@deepseek-ai/dsh-skill`（`dsh-base` 已挂载）；缺它的精简组合里本行会停在待激活状态。
- 运行 MCP 服务需要能 spawn 带管道的子进程；在把 stdio 管道禁掉的受限沙箱里，工具会连接失败。正常启动的 Harness 不受此限制。
- 未包含原项目的 speckit 相关内容（`.specify/`、`specs/`、`.agents/skills/speckit-*`）。
- 全量回填覆盖的是**计划内的词**。墨墨没有按历史日期取当日词表的接口，所以 9 月 1–12 日的逐日清单补不回来；可靠的分日历史从开始每天存快照那天起积累。
- 全量回填后新增进计划的词，要等下一次全量回填或它们出现在某天词表里（增量刷新）才会进镜像。
