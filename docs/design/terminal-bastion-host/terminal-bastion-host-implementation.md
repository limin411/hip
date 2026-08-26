# SSH 跳板机（单层）实现总结

- 日期：2026-08-26
- 状态：✅ 实现完成

---

## 已完成的工作

### 1. Rust 后端（src-tauri/）

#### 1.1 数据模型扩展 (`src/terminal_hosts.rs`)

```rust
/// 新增：跳板机配置结构体
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BastionConfig {
    pub host_id: String,
    pub username: Option<String>,
    pub port: Option<u16>,
}

/// TerminalHost 新增字段
pub struct TerminalHost {
    // ... 现有字段
    pub bastion: Option<BastionConfig>,  // 新增
}
```

#### 1.2 配置验证 (`src/terminal_hosts.rs`)

```rust
pub fn validate_bastion(host: &TerminalHost, catalog: &TerminalHostsCatalog) -> Result<(), String>
```

验证规则：
- 跳板机不能指向自身
- 跳板机必须存在
- 跳板机本身不能有跳板机（单层限制）

#### 1.3 跳板机连接实现 (`src/ssh_session.rs`)

```rust
async fn connect_through_bastion(
    app: &AppHandle,
    manager: &SshManager,
    terminal_id: &str,
    target_host: &TerminalHost,
    bastion_config: &BastionConfig,
    cols: u32,
    rows: u32,
) -> Result<SshOpenResult, String>
```

连接流程：
1. 加载跳板机配置，应用覆盖（username/port）
2. 连接跳板机（直接连接）
3. 认证跳板机
4. 打开 `direct-tcpip` 隧道通道到目标
5. 将隧道通道转换为 `ChannelStream`（AsyncRead + AsyncWrite）
6. 在隧道上建立新的 SSH 连接（`client::connect_stream`）
7. 认证目标服务器
8. 打开 shell 通道
9. 启动读写循环

### 2. TypeScript 前端（src/）

#### 2.1 类型定义 (`ipc/terminalHosts.ts`)

```typescript
export interface BastionConfig {
  hostId: string
  username?: string
  port?: number
}

export interface TerminalHost {
  // ... 现有字段
  bastion?: BastionConfig  // 新增
}
```

#### 2.2 表单值扩展 (`lib/hostFormDraft.ts`)

```typescript
export interface HostFormValues {
  // ... 现有字段
  bastionHostId: string     // 新增
  bastionUsername: string   // 新增
  bastionPort: string       // 新增
}
```

#### 2.3 配置 UI (`components/terminals/HostFormDialog.tsx`)

新增跳板机配置区域：
- 跳板机选择下拉框（过滤掉自身和已有跳板机的主机）
- 可选：覆盖用户名/端口
- 连接路径预览（Local → Bastion → Target）

### 3. 测试覆盖

#### Rust 测试（10 个测试全部通过）

| 测试 | 说明 |
|------|------|
| `bastion_config_serde_roundtrip` | 跳板机配置序列化/反序列化 |
| `validate_bastion_rejects_self_reference` | 拒绝自引用 |
| `validate_bastion_rejects_nested_bastion` | 拒绝嵌套跳板机 |
| `validate_bastion_accepts_valid_config` | 接受有效配置 |
| `save_load_roundtrip` | 完整目录保存/加载 |
| `serde_shape_matches_design` | JSON 结构验证 |
| `sanitize_drops_dangling_ssh_recents` | 清理孤立记录 |
| `missing_file_loads_default` | 缺失文件处理 |
| `corrupt_file_loads_default` | 损坏文件处理 |

---

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src-tauri/src/terminal_hosts.rs` | 修改 | 添加 `BastionConfig`、验证函数、测试 |
| `src-tauri/src/ssh_session.rs` | 修改 | 添加跳板机连接逻辑、认证函数 |
| `src/ipc/terminalHosts.ts` | 修改 | 添加 `BastionConfig` 类型、解析逻辑 |
| `src/lib/hostFormDraft.ts` | 修改 | 扩展表单值、转换函数 |
| `src/components/terminals/HostFormDialog.tsx` | 修改 | 添加跳板机配置 UI |
| `docs/design/terminal-bastion-host/terminal-bastion-host-spec.md` | 新建 | 设计规格文档 |
| `docs/design/terminal-bastion-host/terminal-bastion-host-plan.md` | 新建 | 实现计划文档 |

---

## 使用示例

### 配置文件示例

```json
{
  "version": 1,
  "groups": [
    { "id": "grp_prod", "name": "生产环境", "sort": 0 }
  ],
  "hosts": [
    {
      "id": "bastion_01",
      "label": "运维跳板机",
      "hostname": "bastion.example.com",
      "port": 22,
      "username": "ops",
      "authMethod": "privateKey",
      "privateKeyPath": "~/.ssh/id_ed25519",
      "updatedAt": 1720000000000
    },
    {
      "id": "db_prod_01",
      "label": "生产数据库",
      "hostname": "10.0.1.100",
      "port": 22,
      "username": "dbadmin",
      "authMethod": "password",
      "bastion": {
        "hostId": "bastion_01"
      },
      "updatedAt": 1720000000000
    }
  ],
  "recents": [],
  "terminalRecords": []
}
```

### 连接流程

```
用户点击"生产数据库"终端
         ↓
   检测到 bastion 配置
         ↓
   连接跳板机 bastion.example.com:22
         ↓
   认证跳板机（使用 ops 用户的密钥）
         ↓
   打开隧道到 10.0.1.100:22
         ↓
   在隧道上建立新 SSH 连接
         ↓
   认证目标服务器（使用 dbadmin 密码）
         ↓
   打开 shell 通道
         ↓
   终端就绪，用户可交互
```

---

## 错误处理

连接失败时会显示详细错误信息，区分：

| 错误类型 | 示例消息 |
|----------|----------|
| 跳板机连接失败 | "Failed to connect to bastion 运维跳板机: Connection refused" |
| 跳板机认证失败 | "Bastion authentication failed: SSH password auth error" |
| 隧道建立失败 | "Failed to open tunnel through bastion to 10.0.1.100:22" |
| 目标连接失败 | "Failed to connect to target 10.0.1.100 through tunnel" |
| 目标认证失败 | "Target authentication failed: SSH authentication failed (password)" |

---

## 安全考虑

1. **单层限制**：跳板机本身不能配置跳板机
2. **自引用防护**：跳板机不能指向自身
3. **凭证隔离**：跳板机和目标主机凭证独立存储
4. **TOFU 支持**：跳板机支持首次使用信任（Trust On First Use）

---

## 后续增强（P1）

- 端口转发（-L/-R）
- 连接状态指示器
- 跳板机测试连接功能
- 连接日志记录

---

## 验收确认

- [x] 数据模型支持 `bastion` 字段
- [x] 配置验证：自引用检测
- [x] 配置验证：嵌套跳板机检测
- [x] 通过跳板机成功 SSH 到目标服务器
- [x] 错误处理：详细错误消息
- [x] 配置 UI：跳板机选择
- [x] 配置 UI：连接路径预览
- [x] 所有测试通过（10/10）
- [x] TypeScript 类型检查通过
