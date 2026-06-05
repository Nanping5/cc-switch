import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { providersApi } from "@/lib/api/providers";
import type { Provider } from "@/types";
import {
  settingsApi,
  type RectifierConfig,
  type OptimizerConfig,
} from "@/lib/api/settings";

/** 从供应商 settingsConfig 中提取 modelCatalog.models */
function getCatalogModels(p: Provider): Array<{ model: string; displayName?: string; supportsMultimodal?: boolean }> {
  const sc = p.settingsConfig as Record<string, any> | undefined;
  const catalog = sc?.modelCatalog;
  if (!catalog || !Array.isArray(catalog.models)) return [];
  return catalog.models;
}

export function RectifierConfigPanel() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<RectifierConfig>({
    enabled: true,
    requestThinkingSignature: true,
    requestThinkingBudget: true,
    requestMediaFallback: true,
    requestMediaHeuristic: true,
  });
  const [optimizerConfig, setOptimizerConfig] = useState<OptimizerConfig>({
    enabled: false,
    thinkingOptimizer: true,
    cacheInjection: true,
    cacheTtl: "1h",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [codexProviders, setCodexProviders] = useState<Provider[]>([]);

  useEffect(() => {
    settingsApi
      .getRectifierConfig()
      .then(setConfig)
      .catch((e) => console.error("Failed to load rectifier config:", e))
      .finally(() => setIsLoading(false));
    settingsApi
      .getOptimizerConfig()
      .then(setOptimizerConfig)
      .catch((e) => console.error("Failed to load optimizer config:", e));
    // 加载所有 codex 供应商，用于全局降级模型选择
    providersApi
      .getAll("codex")
      .then((map) =>
        setCodexProviders(
          Object.values(map).filter(
            (p) => getCatalogModels(p).length > 0,
          ),
        ),
      )
      .catch((e) =>
        console.warn("Failed to load codex providers for fallback:", e),
      );
  }, []);

  // 当前选中降级供应商的 catalog 中 supportsMultimodal === true 的模型
  const fallbackMultimodalModels = config.mediaFallbackProvider
    ? codexProviders
        .find((p) => p.id === config.mediaFallbackProvider)
        ?.settingsConfig?.modelCatalog?.models?.filter(
          (m: any) => m.supportsMultimodal === true,
        ) ?? []
    : [];

  const handleChange = async (updates: Partial<RectifierConfig>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    try {
      await settingsApi.setRectifierConfig(newConfig);
    } catch (e) {
      console.error("Failed to save rectifier config:", e);
      toast.error(String(e));
      setConfig(config);
    }
  };

  const handleOptimizerChange = async (updates: Partial<OptimizerConfig>) => {
    const newConfig = { ...optimizerConfig, ...updates };
    setOptimizerConfig(newConfig);
    try {
      await settingsApi.setOptimizerConfig(newConfig);
    } catch (e) {
      console.error("Failed to save optimizer config:", e);
      toast.error(String(e));
      setOptimizerConfig(optimizerConfig);
    }
  };

  if (isLoading) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label>{t("settings.advanced.rectifier.enabled")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("settings.advanced.rectifier.enabledDescription")}
          </p>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={(checked) => handleChange({ enabled: checked })}
        />
      </div>

      <div className="space-y-4">
        <h4 className="text-sm font-medium text-muted-foreground">
          {t("settings.advanced.rectifier.requestGroup")}
        </h4>
        <div className="flex items-center justify-between pl-4">
          <div className="space-y-0.5">
            <Label>{t("settings.advanced.rectifier.thinkingSignature")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.advanced.rectifier.thinkingSignatureDescription")}
            </p>
          </div>
          <Switch
            checked={config.requestThinkingSignature}
            disabled={!config.enabled}
            onCheckedChange={(checked) =>
              handleChange({ requestThinkingSignature: checked })
            }
          />
        </div>
        <div className="flex items-center justify-between pl-4">
          <div className="space-y-0.5">
            <Label>{t("settings.advanced.rectifier.thinkingBudget")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.advanced.rectifier.thinkingBudgetDescription")}
            </p>
          </div>
          <Switch
            checked={config.requestThinkingBudget}
            disabled={!config.enabled}
            onCheckedChange={(checked) =>
              handleChange({ requestThinkingBudget: checked })
            }
          />
        </div>
        <div className="flex items-center justify-between pl-4">
          <div className="space-y-0.5">
            <Label>{t("settings.advanced.rectifier.mediaFallback")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.advanced.rectifier.mediaFallbackDescription")}
            </p>
          </div>
          <Switch
            checked={config.requestMediaFallback}
            disabled={!config.enabled}
            onCheckedChange={(checked) =>
              handleChange({ requestMediaFallback: checked })
            }
          />
        </div>
        <div className="flex items-center justify-between pl-8">
          <div className="space-y-0.5">
            <Label>{t("settings.advanced.rectifier.mediaHeuristic")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.advanced.rectifier.mediaHeuristicDescription")}
            </p>
          </div>
          <Switch
            checked={config.requestMediaHeuristic}
            disabled={!config.enabled || !config.requestMediaFallback}
            onCheckedChange={(checked) =>
              handleChange({ requestMediaHeuristic: checked })
            }
          />
        </div>

        {/* 全局视觉降级模型选择器 */}
        {config.requestMediaFallback && (
          <div className="space-y-3 rounded-lg border border-border-default bg-muted/20 p-4">
            <div className="space-y-0.5">
              <Label>
                {t("settings.advanced.rectifier.mediaFallbackTarget", {
                  defaultValue: "降级目标模型（高级·可选）",
                })}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t(
                  "settings.advanced.rectifier.mediaFallbackTargetDescription",
                  {
                    defaultValue:
                      "当请求包含图片且当前模型不支持多模态时，自动切换到此模型。可选择任意供应商中标记为支持多模态的模型。",
                  },
                )}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* 降级供应商 */}
              <Select
                value={config.mediaFallbackProvider ?? "__none__"}
                onValueChange={(val) =>
                  handleChange({
                    mediaFallbackProvider:
                      val === "__none__" ? undefined : val,
                    // 切换供应商时清空模型选择
                    mediaFallbackModel: undefined,
                  })
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue
                    placeholder={t(
                      "settings.advanced.rectifier.selectFallbackProvider",
                      { defaultValue: "选择供应商" },
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    {t("common.none", { defaultValue: "不指定" })}
                  </SelectItem>
                  {codexProviders.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* 降级模型（仅展示 supportsMultimodal: true） */}
              <Select
                value={config.mediaFallbackModel ?? "__none__"}
                onValueChange={(val) =>
                  handleChange({
                    mediaFallbackModel:
                      val === "__none__" ? undefined : val,
                  })
                }
                disabled={!config.mediaFallbackProvider}
              >
                <SelectTrigger className="h-9">
                  <SelectValue
                    placeholder={t(
                      "settings.advanced.rectifier.selectFallbackModel",
                      { defaultValue: "选择模型" },
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    {t("common.none", { defaultValue: "不指定" })}
                  </SelectItem>
                  {fallbackMultimodalModels.map((m: any) => (
                    <SelectItem key={m.model} value={m.model}>
                      {m.displayName || m.model}
                    </SelectItem>
                  ))}
                  {fallbackMultimodalModels.length === 0 &&
                    config.mediaFallbackProvider && (
                      <SelectItem value="__empty__" disabled>
                        {t(
                          "settings.advanced.rectifier.noMultimodalModels",
                          {
                            defaultValue:
                              "该供应商暂无标记为支持多模态的模型",
                          },
                        )}
                      </SelectItem>
                    )}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      <div className="border-t pt-6 mt-6">
        <div className="space-y-1 mb-4">
          <h3 className="text-sm font-medium">
            {t("settings.advanced.optimizer.title")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("settings.advanced.optimizer.description")}
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{t("settings.advanced.optimizer.enabled")}</Label>
            </div>
            <Switch
              checked={optimizerConfig.enabled}
              onCheckedChange={(checked) =>
                handleOptimizerChange({ enabled: checked })
              }
            />
          </div>

          <div className="space-y-4 pl-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>
                  {t("settings.advanced.optimizer.thinkingOptimizer")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t(
                    "settings.advanced.optimizer.thinkingOptimizerDescription",
                  )}
                </p>
              </div>
              <Switch
                checked={optimizerConfig.thinkingOptimizer}
                disabled={!optimizerConfig.enabled}
                onCheckedChange={(checked) =>
                  handleOptimizerChange({ thinkingOptimizer: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t("settings.advanced.optimizer.cacheInjection")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.advanced.optimizer.cacheInjectionDescription")}
                </p>
              </div>
              <Switch
                checked={optimizerConfig.cacheInjection}
                disabled={!optimizerConfig.enabled}
                onCheckedChange={(checked) =>
                  handleOptimizerChange({ cacheInjection: checked })
                }
              />
            </div>

            {optimizerConfig.cacheInjection && (
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>{t("settings.advanced.optimizer.cacheTtl")}</Label>
                </div>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={optimizerConfig.cacheTtl}
                  disabled={
                    !optimizerConfig.enabled || !optimizerConfig.cacheInjection
                  }
                  onChange={(e) =>
                    handleOptimizerChange({ cacheTtl: e.target.value })
                  }
                >
                  <option value="5m">
                    {t("settings.advanced.optimizer.cacheTtl5m")}
                  </option>
                  <option value="1h">
                    {t("settings.advanced.optimizer.cacheTtl1h")}
                  </option>
                </select>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
