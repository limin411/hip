# SSH 跳板机（单层）实现计划

- 日期：2026-08-26
- Spec：`docs/design/terminal-bastion-host/terminal-bastion-host-spec.md`

---

## 1. 实现目标

支持通过单层跳板机（Bastion/Jump Host）访问内网 SSH 服务器：

```
用户 PC ──→ 跳板机 ──→ 目标服务器
           (bastion)    (target)
```

## 2. 技术方案

### 2.1 核心机制

利用 russh 的 `channel_open_direct_tcpip` 在跳板机连接上打开隧道通道，然后通过 `into_stream()` 将通道转换为 `AsyncRead + AsyncWrite` 流，在其上建立新的 SSH 连接。

```rust
// 关键 API
let tunnel_channel = bastion_handle
    .channel_open_direct_tcpip(target_host, target_port, "127.0.0.1", 0)
    .await?;

let stream = tunnel_channel.into_stream(); // ChannelStream: AsyncRead + AsyncWrite

// 在 stream 上建立新的 SSH 连接
let target_handle = client::connect_stream(stream, target_handler).await?;
```

### 2.2 数据流

```
┌─────────────────────────────────────────────────────────────────┐
│                          hip 客户端                              │
├─────────────────────────────────────────────────────────────────┤
│  SshManager                                                     │
│    ├── bastion_session: SshSession (连接跳板机)                  │
│    │     └── tunnel_channel → into_stream()                     │
│    └── target_session: SshSession (通过隧道连接目标)             │
│          ├── writer → target shell                              │
│          └── reader ← target output                             │
└─────────────────────────────────────────────────────────────────┘
```

## 3. 文件变更清单

### 3.1 Rust 后端（src-tauri/）

| 文件 | 变更类型 | 内容 |
|------|----------|------|
| `src/terminal_hosts.rs` | 修改 | 添加 `BastionConfig` 结构体，扩展 `TerminalHost` |
| `src/ssh_session.rs` | 修改 | 添加跳板机连接逻辑、凭证验证、错误处理 |
| `src/lib.rs` | 可能修改 | 注册新的 Tauri 命令（如有） |

### 3.2 TypeScript 前端（src/）

| 文件 | 变更类型 | 内容 |
|------|----------|------|
| `ipc/terminalHosts.ts` | 修改 | 添加 `BastionConfig` 类型 |
| `store/terminalHostStore.ts` | 修改 | 添加跳板机验证逻辑 |
| `components/terminals/BastionConfigForm.tsx` | 新建 | 跳板机配置 UI |
| `components/terminals/BastionIndicator.tsx` | 新建 | 连接状态指示器 |

### 3.3 测试文件

| 文件 | 变更类型 | 内容 |
|------|----------|------|
| `src-tauri/src/ssh_session.rs` (tests) | 修改 | 跳板机配置验证测试 |
| `src/ipc/terminalHosts.test.ts` | 修改 | 类型解析测试 |

## 4. 实现步骤

### Phase 1：数据模型（预计 1 天）

1. **Rust 侧**
   - 添加 `BastionConfig` 结构体
   - 扩展 `TerminalHost` 添加 `bastion` 字段
   - 添加配置验证函数

2. **TypeScript 侧**
   - 添加 `BastionConfig` 接口
   - 更新 `normalizeHost` 解析逻辑

### Phase 2：跳板机连接核心（预计 2 天）

1. **凭证加载**
   - 复用 `secret_password_key` / `secret_passphrase_key`
   - 支持跳板机凭证独立配置

2. **连接流程**
   - 连接跳板机 → 认证 → 打开隧道 → 连接目标 → 认证 → 打开 shell

3. **Session 管理**
   - 跳板机 session 和目标 session 关联存储
   - 关闭时同时清理两个 session

### Phase 3：配置 UI（预计 1 天）

1. **BastionConfigForm**
   - 跳板机选择下拉框
   - 可选：覆盖用户名/端口
   - 连接路径预览

2. **集成到现有主机编辑表单**

### Phase 4：错误处理与诊断（预计 1 天）

1. **详细错误消息**
   - 跳板机连接失败
   - 跳板机认证失败
   - 隧道建立失败
   - 目标连接/认证失败

2. **状态指示器**
   - 显示"经由跳板机"提示

## 5. 关键代码片段

### 5.1 Rust 数据模型

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BastionConfig {
    pub host_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
}

// TerminalHost 新增字段
pub struct TerminalHost {
    // ... 现有字段
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bastion: Option<BastionConfig>,
}
```

### 5.2 跳板机连接

```rust
async fn connect_through_bastion(
    app: &AppHandle,
    target_host: &TerminalHost,
    bastion_config: &BastionConfig,
) -> Result<(Handle<SshHandler>, Channel<client::Msg>), String> {
    // 1. 加载跳板机配置
    let bastion_host = load_host_meta(app, &bastion_config.host_id)?;
    
    // 2. 连接跳板机
    let mut bastion_handle = connect_direct(app, &bastion_host).await?;
    
    // 3. 打开隧道通道
    let tunnel_channel = bastion_handle
        .channel_open_direct_tcpip(
            &target_host.hostname,
            target_host.port as u32,
            "127.0.0.1",
            0,
        )
        .await
        .map_err(|e| format!("跳板机隧道建立失败: {e}"))?;
    
    // 4. 转换为流
    let stream = tunnel_channel.into_stream();
    
    // 5. 在隧道上建立新 SSH 连接
    let target_handle = client::connect_stream(
        Arc::new(client::Config::default()),
        stream,
        TargetSshHandler,
    ).await.map_err(|e| format!("目标服务器连接失败: {e}"))?;
    
    // 6. 认证目标服务器
    authenticate(app, &target_handle, target_host).await?;
    
    // 7. 打开 shell 通道
    let shell_channel = target_handle
        .channel_open_session()
        .await
        .map_err(|e| format!("目标服务器通道打开失败: {e}"))?;
    
    Ok((target_handle, shell_channel))
}
```

### 5.3 配置验证

```rust
fn validate_bastion(host: &TerminalHost, catalog: &TerminalHostsCatalog) -> Result<(), String> {
    if let Some(bastion) = &host.bastion {
        // 不能指向自己
        if bastion.host_id == host.id {
            return Err("跳板机不能指向自身".into());
        }
        // 跳板机必须存在
        let bastion_host = catalog.hosts.iter()
            .find(|h| h.id == bastion.host_id)
            .ok_or_else(|| format!("跳板机未找到: {}", bastion.host_id))?;
        // 跳板机本身不能有跳板机
        if bastion_host.bastion.is_some() {
            return Err("不支持嵌套跳板机".into());
        }
    }
    Ok(())
}
```

## 6. 风险与应对

| 风险 | 应对 |
|------|------|
| `client::connect_stream` 不存在 | 使用 `client::connect` + 自定义 transport |
| 隧道上认证失败 | 详细日志，支持跳板机单独测试连接 |
| Session 生命周期管理复杂 | 跳板机 session 跟随目标 session 生命周期 |

## 7. 验收标准

- [ ] 配置跳板机后可成功连接到内网目标服务器
- [ ] 跳板机配置不能指向自身（循环检测）
- [ ] 跳板机本身不能配置跳板机（单层限制）
- [ ] 连接失败有明确错误提示（区分跳板机/目标）
- [ ] 关闭终端时正确清理跳板机和目标 session
- [ ] 配置 UI 可选择/清除跳板机

## 8. 时间估算

| 阶段 | 工作量 |
|------|--------|
| Phase 1: 数据模型 | 1 天 |
| Phase 2: 连接核心 | 2 天 |
| Phase 3: 配置 UI | 1 天 |
| Phase 4: 错误处理 | 1 天 |
| **总计** | **5 天** |
