# 墨墨学习 MCP 服务（`mcp-server`）

本目录是 `dsh-momo-learning` 插件包内附的 MCP 服务本体：一个仅供本机单用户使用的**只读** stdio 服务。

**日常使用不需要读这个文件** —— 安装、配置凭证、验证与卸载都在[上一级 README](../README.md)。本文件只说明这一层的边界与开发方式。

## 边界

- 访问令牌只存在操作系统安全凭证存储里（Windows 上是 Credential Manager，服务名 `dsh.momo-learning-mcp`）。MCP 工具既不接收也不返回令牌。
- 学习镜像与本地状态存在 `%LOCALAPPDATA%\MomoLearning\learning.sqlite`。
- 上游只读：只调用墨墨开放 API 的读取端点，不修改账号、不写云词本、不改复习状态。
- 不保存原始 HTTP 响应，也不保存生成的讲解与题目；凭证与请求头不进数据库。

## 与插件的衔接

插件的 `cordis.patch.yml` 通过 `@deepseek-ai/dsh-mcp-client` 以 stdio 方式启动编译后的 `dist/server.js`，命令用的是运行 DSH 的那个 Node（`process.execPath`），工作目录是本目录。工具在模型侧呈现为 `mcp__maimemo__<工具名>`。

## 开发

```sh
npm install
npm run build          # tsc -> dist/
npm run typecheck
npm test               # 单元 + 契约 + 集成
npm run lint
npm run format:check
```

- `dist/` 是 `tsc` 的产物，**会随包提交**：这样 `dsh plugin add` 之后无需构建即可运行。改完 `src/` 记得 `npm run build`。
- `npm start` 直接跑 `dist/server.js`（等价于插件启动它的方式）。
- 凭证操作：`npm run credential -- <set|status|remove>`，需要交互式终端。
- 实时探针：`npm run probe`，只验证已实现且当前获授权的只读端点；非交互式环境必须加 `--yes`。用户自建内容（自建释义、例句、助记）在探针未确认前固定返回 `UNSUPPORTED_CAPABILITY`。

### 从旧命名迁移

早期版本的凭证服务名是 `codex.maimemo-learning-mcp`，数据目录是 `%LOCALAPPDATA%\CodexMomoLearning`。改名后位置变了，但内容没变，用一次迁移把两者搬过来：

```sh
npm run migrate-legacy -- --yes
```

它会把数据库（连同 `-wal` / `-shm` 附属文件）移到新目录，并把旧服务名下的凭证复制到新服务名。**只搬位置，不改任何账号数据**；旧条目会保留，确认无误后自行删除。

## License

MIT，见[上级目录的 LICENSE](../LICENSE)。
