# dsh-momo-learning

墨墨背单词的 DeepSeek Harness 插件。它把你墨墨账号的学习数据同步到本机 SQLite，然后在本地出选择题考你：每天 20 题，一题一题弹窗问，错了记进错题本，答完写一份日报。

整个过程只读，不改你的墨墨账号。

装上之后会多出两样东西，19 个 MCP 工具（名字形如 `mcp__maimemo__maimemo_auth_status`）和一个叫 `momo-daily-learning` 的 Skill。

## 定位

墨墨 App 已经在做记忆这件事了，所以这里管得很窄：

- App 判定为「认识」的词不考
- 今天刚新学的词也不考，刚背完还在短期记忆里，考了没意义
- 只考那些学过一阵子、已经有点忘的词

不代替 App 复习。也不做账号写入——加词、改复习状态、云词本都没有对应工具。

## 前置条件

这个插件目前只在 Windows 上能用。凭证存进 Windows Credential Manager，镜像存到 `%LOCALAPPDATA%\MomoLearning`，没有 macOS / Linux 的凭证后端。

- Node.js `>=24.13.1 <25`。Harness 跑在哪个 Node 上，MCP 服务就用哪个 Node 启动。
- DeepSeek Harness 本身。没装的话 `npx @deepseek-ai/dsh web` 就能起来，从源码安装和 profile 的说明在[官方仓库](https://github.com/deepseek-ai/deepseek-harness)。
- 一个墨墨开放平台的只读凭证。墨墨背单词 App 里「我的 → 更多设置 → 实验功能 → 开放 API」能拿到，也可以去 <https://open.maimemo.com/open/api/v1/tokens/openapi> 申请。有频控，别外传。

## 安装

先装 MCP 服务的依赖。`git clone` 下来的 `mcp-server/node_modules` 是空的，不装的话 MCP 起不来，工具列表里也就不会有 `mcp__maimemo__*`：

```sh
cd dsh-momo-learning
npm run mcp:install
```

`mcp-server/dist` 是编译好的，随仓库一起提交，不用构建。

然后把它装进一个 profile：

```sh
dsh plugin --profile <profile> add ./dsh-momo-learning
```

`dsh plugin` 会初始化 profile（第一个 bundle 是 `@deepseek-ai/dsh-base`），用 pnpm 把本目录链接进去。因为这个包声明了 `dsh.bundle`，它同时会被追加到 `dsh.profile.bundles`。本包没有运行时依赖，这一步不联网。

配墨墨凭证。令牌不能写在配置文件里，只能通过交互式命令存进系统凭证库：

```sh
cd dsh-momo-learning
npm run credential -- set      # 交互式输入
npm run credential -- status
npm run credential -- remove
```

存进去之后条目名是 `dsh.momo-learning-mcp`。

启动前先确认 patch 层合成进去了：

```sh
dsh --profile <profile> --dump-config   # 应该能看到 momo-learning 和 momo-learning-mcp 两行
dsh --profile <profile>
```

不想常驻也可以用一次性 overlay，但包本身还是得先 `dsh plugin add`，不然行里的包名解析不到：

```sh
dsh --profile <profile> --patch ./dsh-momo-learning/cordis.patch.yml
```

### 从旧版本升级

早期版本的凭证服务名是 `codex.maimemo-learning-mcp`，数据目录是 `%LOCALAPPDATA%\CodexMomoLearning`。配过凭证或者同步过镜像的话，先停掉 DSH 再跑：

```sh
npm run migrate-legacy -- --yes
```

它只搬位置，不动账号数据，旧条目会留着让你确认。数据库如果被 DSH 占着会报错让你先停掉，凭证那部分不受影响。

## 示例

```text
你：开始今天的

（弹窗，第 1/20 题）
  The committee will ___ the remaining issues at next week's meeting.
  ○ address    ○ dress    ○ redress    ○ regress

你选了 address

✓ 正确。address 这里是及物动词「处理、着手解决」，不是常见的名词「地址」。
  搭配：address an issue / a problem / a concern
  例句：The report addresses the risks of long-term debt.（这份报告论述了长期债务的风险。）
  易错点：后面接 issue / problem / question 时读作「处理」，跟「地址」没关系。

（第 2/20 题…）

20 题答完：答对 17 / 答错 3。错题进了本地错题本，明天会优先出它们。
日报写到 reports/momo-2026-09-14.md。
```

每题都给中文释义，答对也给。答对不代表真会，释义写出来你才知道自己是不是蒙的。

## 出题范围

出题不看今天学了什么，看的是本地镜像里的整个词表。取词就一条命令：

```
maimemo_list_quiz_candidates({ limit: 20 })
```

排序写在 SQL 里：错题本里没消除的排最前，然后是墨墨打了 `STICKING` 标签的顽固词，再是今天复习时答错、答模糊的，最后是学得少的。同一档里，距上次学习越久的排越前。今天新学的词已经被排除，默认也只取距上次学习至少一天以上的（`minDaysSinceStudy`，默认 1）。每个词都带一个 `reason`，说明它为什么被选中。

每天 20 题，上限 50。候选池经常有几百个词，只取 20，不是有 n 个词就出 n 道题。

今天没排上的词不用管。墨墨的复习排程会继续把它们排进后面几天的词表，到时候带着新的作答结果重新进候选池。

## 题型

只出选择题，四选一。五种形态，都是英语考试里真实存在的：

- **语境选词**：英文句子挖空，四个词里选一个
- **近义替换**：句子里标出一个词，问哪个选项最接近它
- **搭配填空**：空出搭配的一部分，比如 `___ price`
- **形近辨析**：给英文释义，问是哪个词
- **熟词僻义**：句子里用的是生僻义项，问此处什么意思。干扰项里会放这个词最常见的那个意思

不出中英对译（给中文选英文、给英文选中文释义），也不出「给词根选变形」这种题。App 已经在考词义了，再考一遍没意义。题干里不出现中文。

形近选项由 `maimemo_find_similar_words` 提供，它在本地拼写里按编辑距离排。单词效果好（`adapt` / `adopt`），多词短语偏弱（`stiff price` 只能匹配到 `soaring price`），这类词就换同义或同词根的角度出。

## 一题一题问

用 `ask_user_question` 弹窗问，一次一题，等回答再出下一题，不会一次把 20 题列出来。答完先判对错，再给答案和解析。

## 错题和日报

答题过程不存流水。只有答错才写 `quiz_mistake`，一个词一行；再错就累加 `miss_count`，不新增行。答对且没错过的词不写任何东西；答对的是错题本里的词，就标记消除。

整批答完写一份日报到 `<工作区>/reports/momo-YYYY-MM-DD.md`，一天一个文件。里面有题数、对错、错词清单（带累计错了几次），以及从错词里归纳出的薄弱点。数据库留着可查的事实，日报留着给人看的过程记录。

## 镜像怎么保持最新

本地 SQLite 里的学习记录不是历史备份，是出题的取数来源。范围筛选全在本地做，出题不打墨墨的历史记录接口。

第一次用跑一次全量回填。`maimemo_backfill_study_records` 按 `next_study_date` 滑窗分页（上游单次最多 1000 条，没有游标），`{as_count: true}` 给总数，分页走完拿全部记录。只有走到的词数和上游总数相等时才标 `complete`，否则标 `partial` 并说明只覆盖了多少。

以后是增量。`maimemo_sync_today_snapshot` 存完当天词表会顺手刷新学习记录，也可以单独调 `maimemo_refresh_study_records`。两者都先看库里最新的 `observed_at`：

- 当天已经同步过，就只按 `voc_ids` 刷当天那批词，一次调用
- 中间空了整天，就整体重走一遍计划

空了整天为什么不能只查个日期窗口？因为上游只能用 `next_study_date` 筛日期，而学一个词会把它推到未来。按「上次同步到今天」去查，窗口内到期的词可能是 0 个，而这段时间实际学过的词全在窗口外，因为学完就改期了。新词也一样，初学当天 `next_study_date` 就可能排到几十天后。墨墨也没有「按历史日期取当天词表」的接口，漏掉的那几天的词表事后补不回来。所以只有重走能证明完整；计划在 1000 词以内时，它和按词刷新一样只是一次调用。

本地查记录用 `maimemo_query_local_records`，可以按北京时间的日期范围（`last_study_date` / `first_study_date` / `next_study_date` / `add_date`）、标签 `STICKING` / `WELL_FAMILIAR`、学习次数区间筛，支持分页。

## 不漏、不重复

只有走到的词数对上上游 `as_count` 才标 `complete`。滑窗不前进或者撞到页数上限就停下，标 `partial` 并给警告，不会假装走完了。

`mirror_word` 和 `study_record` 都是一词一行，`study_record` 按 `word_id` upsert。`today_item`、`study_window_member`、`todo_entry` 都以（批次或会话, 词）为主键，所以同一批次里同一个词不可能出现两次。本地查询默认只取还在计划里的词。

`today_item`、`study_window_member`、`mirror_sync` 这三张历史表会随同步次数增长，查询取的都是当天最新的批次，结果不会重复。

## 出问题

**工具列表里没有 `mcp__maimemo__*`**：多半是没跑 `npm run mcp:install`。再不然看看启动日志里有没有「墨墨学习 MCP 已通过 stdio 启动。」这一行。

**`maimemo_auth_status` 返回 `configured: false`**：凭证没配，跑 `npm run credential -- set`。

**同步回来 0 个词**：先看凭证对应的账号对不对。我遇到过这种情况，凭证能用、接口也返回 200，但数据全是空的，换成平时刷的那个账号之后立刻就正常了。另一种可能是 App 里「自动同步」没开，服务端没数据，接口只能返回空。

**查询提示只覆盖已验证范围**：先跑一次 `maimemo_backfill_study_records`。

**`--dump-config` 看不到两行**：profile 没装上，或者包路径不对。看 `$DSH_HOME/profiles/<profile>/package.json` 里 `dsh.profile.bundles` 有没有 `dsh-momo-learning`。

**改了 `SKILL.md` 不生效**：Skill 正文是插件加载时读的，得重启 Harness。

## 开发

MCP 服务是 TypeScript，插件入口 `index.js` 是纯 JavaScript，只用 Node 内置模块，不 import 任何 harness 包。

```sh
npm run mcp:install
npm run mcp:build       # tsc -> mcp-server/dist
npm run mcp:typecheck
npm run mcp:test
```

改完 `mcp-server/src/` 记得 `npm run mcp:build`。插件跑的是 `dist/`，而 `dist/` 是随仓库提交的，不重建等于没改。这一层的更多细节在 [`mcp-server/README.md`](mcp-server/README.md)。

## 目录

这是个 bundle。`package.json` 里声明了 `dsh.bundle.patch`，所以 `dsh plugin --profile <n> add <本包>` 会把它作为一层 patch 挂进 profile；它内部再提供插件行——`index.js` 导出 `apply`，`cordis.patch.yml` 把它挂起来。DSH 里 bundle 和 plugin 不是一回事：bundle 是能装进 profile 的一层，plugin 是被 `cordis.yml` 挂载的一行。

| 路径 | 作用 |
|---|---|
| `cordis.patch.yml` | 这个 bundle 的 patch 层：插入本包的插件行，以及一行指向本包 MCP 服务的 `@deepseek-ai/dsh-mcp-client` |
| `index.js` | 插件本体：注册 `momo-daily-learning` Skill，并把本包路径作为 `momoLearningPaths` 服务发布出去 |
| `skills/momo-daily-learning/SKILL.md` | Skill 原文 |
| `mcp-server/` | MCP 服务本体，独立的 TypeScript 子项目，自带 `package.json`、测试和 README |
| `verify.mjs` | 自检脚本 |
| `LICENSE` | MIT |

`cordis.patch.yml` 里两行的顺序不是加载顺序。第一行发布 `momoLearningPaths`，第二行用 `inject` 声明依赖它，Loader 会等注入就绪再求值第二行的 `!!js` 配置。所以 MCP 行拿到的是本包的真实安装路径，不是挂载点或 profile 目录。

## 验证

开个新会话，确认四件事：

1. Skill 目录里有 `momo-daily-learning`，能加载出正文
2. 工具列表里有 19 个 `mcp__maimemo__*`
3. `maimemo_auth_status` 返回 `configured: true`
4. `maimemo_get_learning_overview` 返回镜像概况（还没同步过会带「尚无本地学习镜像」的 warning，这是正常的空状态）

MCP 客户端在插件激活时就完成首次连接和工具发现，所以 3、4 两步在 Harness 起来之后就能用。

不想开会话也可以跑自检脚本。它会按 launcher 的方式合成 `dsh-base` 各层加本 bundle 层，真的启动一次，然后断言 Skill 和 19 个工具都在：

```sh
cp <bundle>/verify.mjs "$DSH_HOME/profiles/<profile>/"
cd "$DSH_HOME/profiles/<profile>"
node verify.mjs
```

通过打印 `PASS`，缺东西就逐条列出来，并以退出码 1 结束。

## 卸载

```sh
dsh plugin --profile <profile> remove dsh-momo-learning
```

依赖和 patch 层都会移除。镜像数据和凭证不会被删。要清镜像数据用 MCP 工具 `maimemo_clear_local_learning_data(confirm: true)`。

## 已知限制

- 不支持写墨墨账号，加词、改复习状态、云词本都没有工具
- `maimemo_sync_word_supplements` 在探针没确认用户自建内容端点前固定返回 `UNSUPPORTED_CAPABILITY`
- 改 `SKILL.md` 要重启 Harness 才生效
- 插件声明了 `inject: ['skills']`，组合里得有 `@deepseek-ai/dsh-skill`（`dsh-base` 已经挂了）。精简组合缺它的话这一行会停在待激活
- MCP 服务要能 spawn 带管道的子进程。把 stdio 管道禁掉的受限沙箱里工具会连不上，正常启动的 Harness 没这个问题
- 逐题弹窗依赖 `ask_user_question`，没有 UI 的会话会退化成一次一题的普通消息提问
- 全量回填覆盖的是计划里的词。墨墨没有按历史日期取当天词表的接口，所以开始用之前的逐日清单补不回来，可靠的分日历史从开始每天存快照那天起积累
- 全量回填之后新加进计划的词，要等下次回填或者出现在某天词表里才会进镜像
- `find_similar_words` 对多词短语偏弱

## 免责声明

这是第三方工具，跟墨墨背单词没有隶属、合作或背书关系，也不代表 DeepSeek 官方。

它只调墨墨开放平台的公开只读接口，凭证需要你自己申请，使用时请遵守墨墨开放 API 的条款和频控（比如每 10 秒 20 次、每 5 小时 2000 次）。学习数据接口目前标注为公测，上游的端点和字段随时可能变，本项目不对可用性作承诺。

题目、解析、例句和日报都是模型生成的，不是墨墨账号原文。墨墨开放接口只给词 id、拼写、作答结果和学习记录，没有释义、例句和词书信息。

访问凭证只存在你本机的系统凭证库里，项目不上传、不转发、不记录。学习数据也只留在本机镜像文件里。

## License

MIT，见 [LICENSE](LICENSE)。
