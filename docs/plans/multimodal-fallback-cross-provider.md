# 多模态降级：全局视觉降级模型 + UI 补全计划

## 背景

后端已实现 `request_contains_images()` 检测和 `media_sanitizer` 的预防/反应式图片降级，
类型定义也已包含 `multimodalFallbackModel` 和 `supportsMultimodal` 字段。
但存在三个关键缺口：

1. **降级模型只能在当前供应商内切换**——`multimodalFallbackModel` 是纯模型名字符串
2. **前端 UI 完全缺失**——没有降级模型选择器，没有 `supportsMultimodal` checkbox
3. **不支持跨供应商降级**——当 MiMo 不支持图片时，无法自动切换到另一个供应商的 GPT-4o

**核心思路**：配置一个全局的视觉降级模型（绑定到某个供应商 + 某个 `supportsMultimodal: true` 的模型），
所有供应商的请求在检测到图片且当前模型不支持多模态时，统一降级到该目标。

已发现的 Bug：`normalizeCodexCatalogModelsForSave()` 丢弃 `supportsMultimodal` 字段。

---

## 现状快照

| 层 | 文件 | 现状 |
|---|---|---|
| TS 类型 | `src/types.ts:221,256` | `multimodalFallbackModel?: string`、`CodexCatalogModel.supportsMultimodal?: boolean` |
| TS 表单 | `src/components/providers/forms/ProviderForm.tsx:512-514` | 有 state + 保存逻辑，无 UI 控件 |
| TS 表单 | `src/components/providers/forms/CodexFormFields.tsx:484` | catalog rows 只有 display/model/context 三列 |
| TS 工具 | `src/components/providers/forms/ProviderForm.tsx:148` | `normalizeCodexCatalogModelsForSave` 丢弃 `supportsMultimodal` |
| TS 预设 | `src/config/codexProviderPresets.ts:646,684` | MiMo 两个预设硬编码 `multimodalFallbackModel: "mimo-v2.5"` |
| Rust 类型 | `src-tauri/src/provider.rs:480-481` | `multimodal_fallback_model: Option<String>`，仅同供应商 |
| Rust 整流 | `src-tauri/src/proxy/types.rs:202` | `RectifierConfig` 全局配置，已有 `request_media_fallback` / `request_media_heuristic` |
| Rust 降级 | `src-tauri/src/proxy/forwarder.rs:1127-1140` | 同供应商内模型名替换（仅 string swap） |
| Rust 检测 | `src-tauri/src/proxy/media_sanitizer.rs:203-234` | `explicit_image_support` 读 `supportsImage`/`modalities.input`，不读 `supportsMultimodal` |
| Rust 兜底 | `src-tauri/src/proxy/media_sanitizer.rs:175-199` | `known_text_only_model` 硬编码名单 |
| Rust 反应 | `src-tauri/src/proxy/forwarder.rs:526` | 上游 4xx 后替换图片为 marker 重试（同供应商） |
| UI 面板 | `src/components/settings/RectifierConfigPanel.tsx` | 全局整流器设置页，已有 media fallback/heuristic 开关 |

---

## 降级优先级设计

降级触发时，按以下优先级选择目标：

1. **同供应商预设降级**（现有行为不变）——`ProviderMeta.multimodalFallbackModel` 只做同供应商模型名替换
2. **全局视觉降级模型**（新增）——当同供应商没有配置降级、或降级目标也不支持图片时，切到全局目标
3. **图片剥离兜底**（现有行为不变）——都没有配置时，走 `media_sanitizer` 的 marker 替换

---

## Phase 1：前端 UI 补全

### 1.1 类型扩展

**文件**: `src/types.ts`

```typescript
// ProviderMeta —— 不改动，保留现有 multimodalFallbackModel
```

不需要在 ProviderMeta 上新增字段。全局降级模型存在 RectifierConfig 里。

### 1.2 修复 normalizeCodexCatalogModelsForSave（Bug fix）

**文件**: `src/components/providers/forms/ProviderForm.tsx:148-176`

当前代码只保留 `model`/`displayName`/`contextWindow`，需补上：

```typescript
normalized.push({
  model,
  ...(displayName ? { displayName } : {}),
  ...(contextWindow && contextWindow > 0 ? { contextWindow } : {}),
  ...(item.supportsMultimodal ? { supportsMultimodal: true } : {}), // 新增
});
```

### 1.3 模型目录编辑器：supportsMultimodal 开关

**文件**: `src/components/providers/forms/CodexFormFields.tsx`

改动点：

- **列头** (line ~472): 从 3 列 `grid-cols-[1fr_1fr_140px_36px]` 扩展为 4 列
  `grid-cols-[1fr_1fr_140px_auto_36px]`，新列标题 "多模态"
- **行** (line ~484): 在 contextWindow `<Input>` 和删除 `<Button>` 之间插入一个 `<Switch>`
  绑定 `row.supportsMultimodal ?? false`，`onCheckedChange` → `handleUpdateCatalogRow(index, { supportsMultimodal: checked })`
- **Props**: `CodexFormFieldsProps` 无需改动（`CodexCatalogModel` 已包含该字段）

### 1.4 全局视觉降级模型选择器

**位置**: `src/components/settings/RectifierConfigPanel.tsx`

在现有的 `mediaFallback` / `mediaHeuristic` 开关下方，新增两个下拉框：

```
┌─ 降级目标供应商 ─────────────────────────────┐
│ [Select: 所有 codex 供应商，含 catalog 的]     │
└──────────────────────────────────────────────┘
┌─ 降级目标模型 ────────────────────────────────┐
│ [Select: 选中供应商 catalog 中               │
│          supportsMultimodal === true 的模型]  │
└──────────────────────────────────────────────┘
提示: 当请求包含图片且当前模型不支持多模态时，自动切换到此模型。
      需同时开启上方「图片降级」开关。
```

**数据来源**：
- 供应商列表 → `providersApi.getAll("codex")`，过滤出有 `meta.modelCatalog` 且非空的
- 模型列表 → 选中供应商的 `meta.modelCatalog`，`filter(m => m.supportsMultimodal === true)`
- 保存 → `RectifierConfig` 新增字段（见 Phase 2），通过现有 `settingsApi.setRectifierConfig()` 保存

**注意**：如果选中供应商的 catalog 中没有任何 `supportsMultimodal: true` 的模型，
模型下拉显示空状态提示："该供应商暂无标记为支持多模态的模型，请先在供应商设置的模型映射中标记"。

### 1.5 预设中的降级模型（保留现有行为）

**文件**: `src/config/codexProviderPresets.ts`

`multimodalFallbackModel` 在预设中保留，作为同供应商内的快捷降级（如 MiMo-v2.5-pro → mimo-v2.5）。
这与全局视觉降级不冲突，优先级更高。

---

## Phase 2：后端全局视觉降级

### 2.1 RectifierConfig 扩展

**文件**:

- `src-tauri/src/proxy/types.rs` — Rust `RectifierConfig`
- `src/lib/api/settings.ts` — TS `RectifierConfig`

新增两个字段：

```rust
// Rust
#[serde(rename = "mediaFallbackProvider", skip_serializing_if = "Option::is_none")]
pub media_fallback_provider: Option<String>,
#[serde(rename = "mediaFallbackModel", skip_serializing_if = "Option::is_none")]
pub media_fallback_model: Option<String>,
```

```typescript
// TypeScript
export interface RectifierConfig {
  // ... 现有字段 ...
  mediaFallbackProvider?: string;
  mediaFallbackModel?: string;
}
```

### 2.2 media_sanitizer 扩展：支持 supportsMultimodal 字段

**文件**: `src-tauri/src/proxy/media_sanitizer.rs`

`explicit_image_support()` (line 221-234) 已检查 `supportsImage`、`vision`、
`modalities.input`、`input_modalities` 等字段。

新增检查 `supportsMultimodal` 字段：

```rust
fn explicit_image_support(entry: &Value) -> Option<bool> {
    // 现有检查 supportsImage / vision...

    // 新增：检查 supportsMultimodal 字段
    if let Some(supports) = entry
        .get("supportsMultimodal")
        .or_else(|| entry.get("supports_multimodal"))
        .and_then(Value::as_bool)
    {
        return Some(supports);
    }

    // 继续 modalities 检查...
}
```

这样前端在模型目录中标记的 `supportsMultimodal: true/false` 就能被后端感知，
用于 `replace_images_for_text_only_model` 的预防式判断。

### 2.3 forwarder 降级逻辑改造

**文件**: `src-tauri/src/proxy/forwarder.rs`

当前逻辑 (line 1127-1140)：只做同供应商模型名替换。

改造为两级降级：

```rust
// 在 forward() 中，替换现有的降级块：
if super::model_mapper::request_contains_images(&mapped_body) {
    let meta = provider.meta.as_ref();

    // 第一优先级：同供应商预设降级（现有行为）
    if let Some(fallback_model) = meta.and_then(|m| m.multimodal_fallback_model.as_deref()) {
        let original_model = mapped_body["model"].as_str().unwrap_or("?").to_string();
        log::info!("[ModelMapper] 检测到图片内容，同供应商降级: {} → {}",
            original_model, fallback_model);
        mapped_body["model"] = serde_json::json!(fallback_model);
    }
    // 第二优先级：全局视觉降级（新增）
    else if let (Some(global_pid), Some(global_model)) = (
        self.rectifier_config.media_fallback_provider.as_deref(),
        self.rectifier_config.media_fallback_model.as_deref(),
    ) {
        let original_model = mapped_body["model"].as_str().unwrap_or("?").to_string();
        log::info!("[ModelMapper] 检测到图片内容，全局降级: {} → provider={}, model={}",
            original_model, global_pid, global_model);

        // 查找目标供应商，切换 provider + model
        if let Some(target_provider) = self.router.get_provider(global_pid) {
            mapped_body["model"] = serde_json::json!(global_model);
            // 用目标供应商重新执行 forward（含完整认证/格式转换）
            // 需要将 provider 替换为 target_provider
            return self.forward(
                app_type, method, target_provider, endpoint,
                &mapped_body, headers, extensions, adapter,
            ).await;
        } else {
            log::warn!("[ModelMapper] 全局降级供应商 {} 不存在，跳过降级", global_pid);
        }
    }
    // 第三优先级：不干预，让请求正常发送（由 media_sanitizer 兜底）
}
```

### 2.4 架构考量

1. **`self.router.get_provider()`**：需要确认 `RequestForwarder` 是否能通过
   `ProviderRouter` 按 ID 查找任意供应商。如果不行，需要在构造时注入
   `ProviderManager` 引用，或在 `forward_with_retry_inner` 层面拦截。

2. **adapter 差异**：目标供应商可能用不同的 adapter（Claude vs Codex vs Gemini）。
   `forward()` 内部根据 `app_type` 选择 adapter，所以切换 provider 后
   adapter 也需要重新解析。如果 app_type 是 Codex，目标供应商也必须是 Codex 类型。

3. **循环防护**：全局降级的 `forward()` 调用不能再触发全局降级，
   否则会无限递归。需要加一个 `is_global_fallback: bool` 参数或上下文标志，
   在递归调用中跳过降级逻辑。

4. **与 failover 的关系**：全局降级是在请求发送前的主动切换，
   不应触发 failover。建议在降级分支中设置标志位，
   让后续的 failover 逻辑知道这次是降级而非失败。

5. **API 格式兼容性**：建议 UI 上只展示与当前 app_type 兼容的供应商。
   例如 Codex 应用只展示 Codex 类型供应商的 catalog，不展示 Claude 供应商。

---

## 改动清单

### Phase 1（前端）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `src/components/providers/forms/ProviderForm.tsx:148-176` | Bug fix: `normalizeCodexCatalogModelsForSave` 保留 `supportsMultimodal` |
| 2 | `src/components/providers/forms/CodexFormFields.tsx:470-490` | catalog grid 加 `supportsMultimodal` Switch 列 |
| 3 | `src/components/settings/RectifierConfigPanel.tsx` | 新增全局降级供应商+模型两个 Select |
| 4 | `src/lib/api/settings.ts:264` | `RectifierConfig` 加 `mediaFallbackProvider` / `mediaFallbackModel` |
| 5 | `tests/components/ProviderForm.codexCatalog.test.ts` | 测试 `supportsMultimodal` 保存 |

### Phase 2（后端）

| # | 文件 | 改动 |
|---|---|---|
| 6 | `src-tauri/src/proxy/types.rs:202` | `RectifierConfig` 加 `media_fallback_provider` / `media_fallback_model` |
| 7 | `src-tauri/src/proxy/media_sanitizer.rs:221` | `explicit_image_support` 增加 `supportsMultimodal` 检查 |
| 8 | `src-tauri/src/proxy/forwarder.rs:1127` | 降级逻辑改为两级：同供应商 → 全局跨供应商 |
| 9 | `src-tauri/src/proxy/forwarder.rs` | 循环降级防护标志 |
| 10 | 后端测试 | `media_sanitizer` 新增 `supportsMultimodal` 测试；`forwarder` 全局降级集成测试 |

---

## 实施建议

1. **Phase 1 和 Phase 2.6/2.7 可以一起做**——前端 UI + Bug fix + media_sanitizer 扩展，改动小且互相独立
2. **Phase 2.8（forwarder 跨供应商路由）单独 PR**——需要确认 router 的 provider 查找能力，改动面大
3. 如果 `ProviderRouter` 不支持按 ID 查找任意供应商，可以改用
   `forward_with_retry_inner` 的 `providers` 列表中查找——该列表已包含所有可用供应商

---

## 测试策略

- **前端**: 更新 `ProviderForm.codexCatalog.test.ts` 验证 `supportsMultimodal` 序列化不丢；
  `RectifierConfigPanel` 新增交互测试验证降级下拉保存
- **后端**: `media_sanitizer` 现有测试基础上新增 `supportsMultimodal` 字段的测试用例；
  `forwarder` 新增全局降级的集成测试（mock 两个供应商，验证跨供应商路由）
