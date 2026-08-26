# 终端管理 · SSH 跳板机（Bastion/Jump Host）能力 Spec

- 系列：`docs/design/terminal-bastion-host/`
- 状态：待评审
- 日期：2026-08-26
- 前置基线：
  - `src-tauri/src/ssh_session.rs`（SSH 会话管理，已实现直接连接）
  - `src-tauri/src/terminal_hosts.rs`（主机目录管理，已实现）
  - `src/ipc/terminalHosts.ts`（前端 IPC 接口）
  - `src/store/terminalHostStore.ts`（前端状态管理）
- 涉及模块：
  - `src-tauri/src/ssh_session.rs`（SSH 会话核心逻辑）
  - `src-tauri/src/terminal_hosts.rs`（主机目录数据结构）
  - `src/ipc/terminalHosts.ts`（前端 IPC 接口）
  - `src/ipc/ssh.ts`（SSH 操作 IPC）
  - `src/store/terminalHostStore.ts`（前端状态管理）
  - `src/components/terminals/`（终端 UI 组件）

---

## 1. 根因：企业内网 SSH 访问受限

### 1.1 现状

当前仅支持直连模式，无法通过跳板机访问内网服务器：

```
现状：                          目标：
┌────────┐        ┌────────┐   ┌────────┐    ┌────────┐    ┌────────┐
│ 用户PC  │ ──?──→ │ 内网DB  │   │ 用户PC  │ ──→ │ 跳板机  │ ──→ │ 内网DB  │
└────────┘        └────────┘   └────────┘    └────────┘    └────────┘
   ❌ 不可达                     ✅ 通过跳板机透明代理
```

### 1.2 根因

| # | 现象 | 代码证据 | 根因 |
|---|------|----------|------|
| A1 | 内网服务器无法从外部直接 SSH | `ssh_session.rs` 仅 `client::connect(addr)` | 无跳板机代理机制 |
| A2 | 安全策略要求所有访问经过审计跳板机 | `TerminalHost` 无 `bastionHost` 字段 | 数据模型不支持 |
| A3 | 用户需手动在跳板机上执行 `ssh target` | 无隧道实现 | 缺乏透明跳转能力 |

---

## 2. 行业实践参考

| 方案 | 关键机制 | 启示 |
|------|----------|------|
| **OpenSSH ProxyJump** | `ssh -J bastion target`，客户端多跳 | 标准方案，透明代理 |
| **OpenSSH ProxyCommand** | `ssh -o ProxyCommand="ssh bastion nc %h %p" target` | 灵活自定义代理 |
| **WezTerm SSH** | 内置 `proxy_command` 配置 | GUI 应用参考 |

**技术选型**：采用客户端 ProxyJump（russh `direct-tcpip` 通道），无需远端改造。

---

## 3. 改进项

### T1 数据模型扩展（P0）

#### 1.1 TerminalHost 结构扩展

```rust
// src-tauri/src/terminal_hosts.rs

/// 跳板机配置
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BastionConfig {
    /// 跳板机主机 ID（引用同 catalog 中的 TerminalHost）
    pub host_id: String,
    /// 可选：覆盖跳板机用户名（默认使用目标主机的 username）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    /// 可选：覆盖跳板机端口（默认使用目标主机的 port）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
}

// 扩展 TerminalHost
pub struct TerminalHost {
    // ... 现有字段 ...
    
    /// 跳板机配置（单层，不支持嵌套）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bastion: Option<BastionConfig>,
}
```

#### 1.2 TypeScript 类型同步

```typescript
// src/ipc/terminalHosts.ts

export interface BastionConfig {
  hostId: string
  username?: string
  port?: number
}

export interface TerminalHost {
  // ... 现有字段 ...
  bastion?: BastionConfig
}
```

#### 1.3 配置示例

```json
// ~/.hip/config/terminal-hosts.json
{
  "version": 1,
  "groups": [
    { "id": "grp_prod", "name": "生产环境", "sort": 0 }
  ],
  "hosts": [
    {
      "id": "bastion_01",
      "label": "运维跳板机",
      "groupId": "grp_prod",
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
      "groupId": "grp_prod",
      "hostname": "10.0.1.100",
      "port": 22,
      "username": "dbadmin",
      "authMethod": "privateKey",
      "privateKeyPath": "~/.ssh/id_ed25519",
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

---

### T2 ProxyJump 连接实现（P0）

#### 2.1 架构

```
连接流程：
┌──────────┐      ┌──────────────┐      ┌──────────────┐
│  用户 PC  │ ───→ │   跳板机     │ ───→ │  目标服务器   │
│  (hip)   │      │ bastion_01   │      │ db_prod_01   │
└──────────┘      └──────────────┘      └──────────────┘
     │                   │                    │
     │   Session 1       │    Session 2       │
     │  (直接连接)        │  (通过隧道)         │
     └───────────────────┴────────────────────┘
           两个独立 SSH Session，通过 direct-tcpip 串联
```

#### 2.2 核心实现

```rust
// src-tauri/src/ssh_session.rs

/// 检查跳板机配置是否合法（防止自引用）
fn validate_bastion_config(host: &TerminalHost, catalog: &TerminalHostsCatalog) -> Result<(), String> {
    if let Some(bastion) = &host.bastion {
        // 不能指向自己
        if bastion.host_id == host.id {
            return Err("跳板机不能指向自身".into());
        }
        // 跳板机必须存在
        if !catalog.hosts.iter().any(|h| h.id == bastion.host_id) {
            return Err(format!("跳板机主机未找到: {}", bastion.host_id));
        }
        // 跳板机本身不能配置跳板机（单层限制）
        if let Some(bastion_host) = catalog.hosts.iter().find(|h| h.id == bastion.host_id) {
            if bastion_host.bastion.is_some() {
                return Err("不支持嵌套跳板机（仅支持单层）".into());
            }
        }
    }
    Ok(())
}

/// 通过跳板机建立 SSH 连接
async fn connect_through_bastion(
    app: &AppHandle,
    target_host: &TerminalHost,
    bastion_config: &BastionConfig,
    cols: u32,
    rows: u32,
) -> Result<(Handle<SshHandler>, Channel<client::Msg>), String> {
    let catalog = load_catalog_for_bastion(app)?;
    
    // 1. 加载跳板机配置
    let bastion_host = catalog.hosts.iter()
        .find(|h| h.id == bastion_config.host_id)
        .ok_or_else(|| format!("跳板机主机未找到: {}", bastion_config.host_id))?
        .clone();
    
    // 2. 建立跳板机连接（直接连接，无嵌套）
    let bastion_handle = connect_direct(app, &bastion_host).await?;
    
    // 3. 通过跳板机的 direct-tcpip 通道连接目标
    let target_hostname = &target_host.hostname;
    let target_port = target_host.port as u32;
    
    let tunnel_channel = bastion_handle
        .channel_open_direct_tcpip(
            target_hostname,
            target_port,
            "127.0.0.1",
            0,
        )
        .await
        .map_err(|e| format!("跳板机隧道通道打开失败: {e}"))?;
    
    // 4. 在隧道通道上进行 SSH 握手和认证
    // 注意：russh 需要将 channel 转换为 io::AsyncRead + io::AsyncWrite
    // 然后在其上建立新的 SSH 连接
    
    let (tunnel_read, tunnel_write) = tunnel_channel.split();
    
    // 创建基于隧道的传输层
    let transport = russh::transport::new_transport(
        tunnel_read,
        tunnel_write,
        russh::client::Config::default(),
    );
    
    // 在隧道上进行 SSH 握手
    let target_session = russh::client::connect_transport(
        transport,
        TargetSshHandler::new(app, target_host),
    ).await.map_err(|e| format!("目标服务器 SSH 握手失败: {e}"))?;
    
    // 5. 对目标服务器进行认证
    authenticate_session(app, &target_session, target_host).await?;
    
    // 6. 打开 shell 通道
    let shell_channel = target_session
        .channel_open_session()
        .await
        .map_err(|e| format!("目标服务器通道打开失败: {e}"))?;
    
    Ok((target_session, shell_channel))
}

/// 直接 SSH 连接（无跳板机）
async fn connect_direct(
    app: &AppHandle,
    host: &TerminalHost,
) -> Result<Handle<SshHandler>, String> {
    // 复用现有 ssh_open 中的连接逻辑
    // ... 省略，与当前实现相同 ...
}

/// 通用认证函数（复用现有逻辑）
async fn authenticate_session(
    app: &AppHandle,
    handle: &Handle<SshHandler>,
    host: &TerminalHost,
) -> Result<(), String> {
    // 复用现有认证逻辑（password / privateKey）
    // ... 省略，与当前实现相同 ...
}
```

#### 2.3 SSH Open 命令修改

```rust
#[tauri::command]
pub async fn ssh_open(
    app: AppHandle,
    manager: State<'_, SshManager>,
    budget: State<'_, TerminalBudget>,
    terminal_id: String,
    host_id: String,
    cols: u16,
    rows: u16,
) -> Result<SshOpenResult, String> {
    // ... 现有验证逻辑 ...
    
    let catalog = load_catalog_for_bastion(&app)?;
    let host = catalog.hosts.iter()
        .find(|h| h.id == host_id)
        .ok_or_else(|| format!("主机未找到: {host_id}"))?
        .clone();
    
    // 验证跳板机配置
    validate_bastion_config(&host, &catalog)?;
    
    // 根据是否有跳板机选择连接方式
    let (handle, channel) = if let Some(bastion_config) = &host.bastion {
        // 通过跳板机连接
        connect_through_bastion(&app, &host, bastion_config, cols as u32, rows as u32).await?
    } else {
        // 直接连接（现有逻辑）
        let handle = connect_direct(&app, &host).await?;
        let channel = handle.channel_open_session().await
            .map_err(|e| format!("通道打开失败: {e}"))?;
        (handle, channel)
    };
    
    // 后续：request_pty、request_shell、启动读写循环...
    // 与现有逻辑相同
    
    Ok(SshOpenResult { reused: false, generation })
}
```

---

### T3 配置 UI（P0）

#### 3.1 跳板机配置表单

```tsx
// src/components/terminals/BastionConfigForm.tsx

import { useState, useMemo } from 'react'
import { useTerminalHostStore } from '@/store/terminalHostStore'
import type { TerminalHost, BastionConfig } from '@/ipc/terminalHosts'

interface BastionConfigFormProps {
  host: TerminalHost
  onSave: (bastion: BastionConfig | undefined) => void
  onCancel: () => void
}

export function BastionConfigForm({ host, onSave, onCancel }: BastionConfigFormProps) {
  const hosts = useTerminalHostStore(s => s.hosts)
  const [selectedBastionId, setSelectedBastionId] = useState(host.bastion?.hostId ?? '')
  const [overrideUsername, setOverrideUsername] = useState(host.bastion?.username ?? '')
  const [overridePort, setOverridePort] = useState(host.bastion?.port?.toString() ?? '')
  
  // 过滤掉当前主机和已有跳板机配置的主机（防止嵌套）
  const availableBastions = useMemo(() => 
    hosts.filter(h => 
      h.id !== host.id &&           // 不能指向自己
      !h.bastion                     // 跳板机本身不能有跳板机（单层限制）
    ),
    [hosts, host.id]
  )
  
  const handleSave = () => {
    if (!selectedBastionId) {
      onSave(undefined)
      return
    }
    
    onSave({
      hostId: selectedBastionId,
      username: overrideUsername || undefined,
      port: overridePort ? parseInt(overridePort) : undefined,
    })
  }
  
  // 获取选中的跳板机信息用于预览
  const selectedBastion = hosts.find(h => h.id === selectedBastionId)
  
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">跳板机（可选）</label>
        <select
          value={selectedBastionId}
          onChange={e => setSelectedBastionId(e.target.value)}
          className="w-full rounded-sm border border-[var(--border)] px-3 py-2 bg-[var(--bg-content)]"
        >
          <option value="">直连（不使用跳板机）</option>
          {availableBastions.map(h => (
            <option key={h.id} value={h.id}>
              {h.label} ({h.hostname}:{h.port})
            </option>
          ))}
        </select>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          选择跳板机后，连接将通过该服务器代理到目标主机
        </p>
      </div>
      
      {selectedBastion && (
        <>
          <div>
            <label className="block text-sm font-medium mb-1">
              覆盖用户名（可选）
            </label>
            <input
              type="text"
              value={overrideUsername}
              onChange={e => setOverrideUsername(e.target.value)}
              placeholder={`默认: ${host.username}`}
              className="w-full rounded-sm border border-[var(--border)] px-3 py-2 bg-[var(--bg-content)]"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">
              覆盖端口（可选）
            </label>
            <input
              type="number"
              value={overridePort}
              onChange={e => setOverridePort(e.target.value)}
              placeholder={`默认: ${selectedBastion.port}`}
              className="w-full rounded-sm border border-[var(--border)] px-3 py-2 bg-[var(--bg-content)]"
            />
          </div>
          
          {/* 连接路径预览 */}
          <div className="p-3 bg-[var(--bg-muted)] rounded-lg">
            <div className="text-xs text-[var(--text-secondary)] mb-2">连接路径</div>
            <div className="flex items-center gap-2 text-sm">
              <span className="px-2 py-1 bg-[var(--bg-content)] rounded font-mono text-xs">
                本地
              </span>
              <span className="text-[var(--text-tertiary)]">→</span>
              <span className="px-2 py-1 bg-[var(--accent)]/10 text-[var(--accent)] rounded font-mono text-xs">
                {selectedBastion.label}
              </span>
              <span className="text-[var(--text-tertiary)]">→</span>
              <span className="px-2 py-1 bg-[var(--bg-content)] rounded font-mono text-xs">
                {host.label}
              </span>
            </div>
          </div>
        </>
      )}
      
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel}>取消</Button>
        <Button onClick={handleSave}>保存</Button>
      </div>
    </div>
  )
}
```

#### 3.2 连接状态指示器

```tsx
// src/components/terminals/BastionIndicator.tsx

interface BastionIndicatorProps {
  host: TerminalHost
  connectionStatus?: 'connecting' | 'connected' | 'failed'
}

export function BastionIndicator({ host, connectionStatus }: BastionIndicatorProps) {
  if (!host.bastion) return null
  
  const bastionHost = useTerminalHostStore(s => 
    s.hosts.find(h => h.id === host.bastion?.hostId)
  )
  
  if (!bastionHost) return null
  
  return (
    <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
      <div className={cn(
        'w-1.5 h-1.5 rounded-full',
        connectionStatus === 'connected' && 'bg-[var(--success)]',
        connectionStatus === 'connecting' && 'bg-[var(--warning)] animate-pulse',
        connectionStatus === 'failed' && 'bg-[var(--danger)]',
        !connectionStatus && 'bg-[var(--text-tertiary)]',
      )} />
      <span>经由 {bastionHost.label}</span>
    </div>
  )
}
```

---

### T4 连接诊断（P1）

#### 4.1 错误处理增强

```rust
// src-tauri/src/ssh_session.rs

/// 跳板机相关错误类型
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BastionError {
    /// 跳板机连接失败
    BastionConnectFailed { bastion_id: String, error: String },
    /// 跳板机认证失败
    BastionAuthFailed { bastion_id: String },
    /// 隧道建立失败
    TunnelFailed { error: String },
    /// 目标服务器连接失败（通过隧道）
    TargetConnectFailed { error: String },
    /// 目标服务器认证失败
    TargetAuthFailed {},
}

/// 增强的错误消息
fn format_bastion_error(err: &BastionError, host: &TerminalHost, bastion_host: &TerminalHost) -> String {
    match err {
        BastionError::BastionConnectFailed { error, .. } => {
            format!(
                "无法连接到跳板机 {} ({}:{}): {}",
                bastion_host.label, bastion_host.hostname, bastion_host.port, error
            )
        }
        BastionError::BastionAuthFailed { .. } => {
            format!(
                "跳板机 {} 认证失败，请检查用户名和密码/密钥",
                bastion_host.label
            )
        }
        BastionError::TunnelFailed { error } => {
            format!(
                "通过跳板机 {} 建立隧道到 {}:{} 失败: {}",
                bastion_host.label, host.hostname, host.port, error
            )
        }
        BastionError::TargetConnectFailed { error } => {
            format!(
                "无法通过跳板机连接到目标 {} ({}:{}): {}",
                host.label, host.hostname, host.port, error
            )
        }
        BastionError::TargetAuthFailed {} => {
            format!(
                "目标服务器 {} 认证失败（已通过跳板机 {}）",
                host.label, bastion_host.label
            )
        }
    }
}
```

---

## 4. 安全考虑

### 4.1 单层限制

- 跳板机本身**不能**配置 `bastion` 字段（防止嵌套）
- 配置 UI 中过滤掉已有跳板机的主机
- Rust 侧校验并返回明确错误

### 4.2 凭证隔离

- 跳板机和目标主机凭证独立存储
- 复用现有 `hip.ssh.<hostId>.password` / `hip.ssh.<hostId>.passphrase` 机制
- 不做凭证传递或代理

### 4.3 自引用防护

- 校验 `bastion.host_id != host.id`
- 前端 + 后端双重校验

---

## 5. 实施计划

| 阶段 | 内容 | 周期 |
|------|------|------|
| **P0-1** | 数据模型扩展（Rust + TypeScript） | 2 天 |
| **P0-2** | ProxyJump 连接核心实现 | 3 天 |
| **P0-3** | 配置 UI（跳板机选择表单） | 2 天 |
| **P0-4** | 集成测试 + 错误处理完善 | 2 天 |
| **P1-1** | 连接状态指示器 + 诊断增强 | 2 天 |

**总计**：约 2 周

---

## 6. 验收清单

| # | 验收点 | 阶段 |
|---|--------|------|
| 1 | 主机配置支持 `bastion` 字段 | P0-1 |
| 2 | 配置跳板机不能指向自身 | P0-1 |
| 3 | 跳板机本身不能有跳板机（单层限制） | P0-1 |
| 4 | 通过跳板机成功 SSH 到目标服务器 | P0-2 |
| 5 | 跳板机连接失败有明确错误提示 | P0-2 |
| 6 | 跳板机认证失败有明确错误提示 | P0-2 |
| 7 | 配置 UI 可选择/清除跳板机 | P0-3 |
| 8 | 连接路径预览正确显示 | P0-3 |
| 9 | 终端面板显示"经由跳板机"指示 | P1-1 |

---

## 7. 非目标

- ❌ 多层嵌套跳板机（A→B→C）
- ❌ 动态 SOCKS 代理（-D）
- ❌ 端口转发（-L/-R）—— 后续独立需求
- ❌ SSH Agent 转发
- ❌ 远端 ProxyCommand

---

## 8. 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| russh `direct-tcpip` API 限制 | 中 | 评估 russh 文档，必要时使用 channel 转换 |
| 隧道上 SSH 握手实现复杂 | 中 | 参考 russh 示例，必要时贡献 PR |
| 连接超时导致体验差 | 低 | 跳板机和目标独立超时配置 |

---

## 9. 参考资料

- [OpenSSH ProxyJump](https://man.openbsd.org/ssh#J)
- [russh direct-tcpip](https://docs.rs/russh/)
- [WezTerm SSH proxy](https://wezfurlong.org/wezterm/config/lua/SshDomain.html)
