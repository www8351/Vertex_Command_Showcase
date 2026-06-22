import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Send, CheckCircle, XCircle, Loader2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiUrl } from "@/lib/apiBase";

interface WebhookStatus {
  webhookEnabled: boolean;
  discordWebhookUrl: string | null;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  hasDiscord: boolean;
  hasTelegram: boolean;
}

export function WebhookSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [discordUrl, setDiscordUrl] = useState("");
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramChat, setTelegramChat] = useState("");
  const [showDiscord, setShowDiscord] = useState(false);
  const [showTelegram, setShowTelegram] = useState(false);
  const [testResult, setTestResult] = useState<{ discord: boolean; telegram: boolean; errors: string[] } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data: status } = useQuery<WebhookStatus>({
    queryKey: ["/api/v1/settings/webhooks"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/v1/settings/webhooks"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (body: Record<string, any>) => {
      const res = await fetch(apiUrl("/api/v1/settings/webhooks"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      setSaveError(null);
      queryClient.invalidateQueries({ queryKey: ["/api/v1/settings/webhooks"] });
      setDiscordUrl("");
      setTelegramToken("");
      setTelegramChat("");
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(apiUrl("/api/v1/settings/webhooks/test"), {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to test");
      return res.json();
    },
    onSuccess: (data) => setTestResult(data),
  });

  const toggleEnabled = () => {
    saveMutation.mutate({ webhookEnabled: !status?.webhookEnabled });
  };

  const saveDiscord = () => {
    if (!discordUrl.startsWith("https://discord.com/api/webhooks/") && !discordUrl.startsWith("https://discordapp.com/api/webhooks/")) return;
    saveMutation.mutate({ discordWebhookUrl: discordUrl, webhookEnabled: true });
  };

  const saveTelegram = () => {
    if (!telegramToken || !telegramChat) return;
    saveMutation.mutate({ telegramBotToken: telegramToken, telegramChatId: telegramChat, webhookEnabled: true });
  };

  const removeDiscord = () => {
    saveMutation.mutate({ discordWebhookUrl: "" });
  };

  const removeTelegram = () => {
    saveMutation.mutate({ telegramBotToken: "", telegramChatId: "" });
  };

  return (
    <div className="bg-card p-5 rounded-lg border border-border" data-testid="section-webhook-settings">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Bell className="w-4 h-4 text-amber-500" />
          {t("settings.webhookNotifications", "התראות Webhook")}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {status?.webhookEnabled ? t("common.enabled", "פעיל") : t("common.disabled", "כבוי")}
          </span>
          <Switch
            checked={status?.webhookEnabled || false}
            onCheckedChange={toggleEnabled}
            data-testid="switch-webhook-enabled"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-4">
        {t("settings.webhookDescription", "קבל התראות בזמן אמת ל-Discord או Telegram כאשר מנוע הסיכון מבצע פעולות — drawdown breach, sync recovery, flatten.")}
      </p>

      {saveError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 flex items-center gap-2 text-xs text-red-500" data-testid="text-webhook-error">
          <XCircle className="w-4 h-4 shrink-0" />
          {saveError}
        </div>
      )}

      <div className="space-y-4">
        <div className="bg-secondary/30 p-4 rounded-lg border border-border">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-[#5865F2] flex items-center justify-center">
                <span className="text-white text-xs font-bold">D</span>
              </div>
              <span className="text-sm font-medium">Discord</span>
            </div>
            {status?.hasDiscord && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-emerald-500 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> {t("common.connected", "מחובר")}
                </span>
                <span className="text-[10px] text-muted-foreground font-mono" dir="ltr">{status.discordWebhookUrl}</span>
              </div>
            )}
          </div>
          {status?.hasDiscord ? (
            <Button variant="outline" size="sm" onClick={removeDiscord} className="h-7 text-[11px]" data-testid="button-remove-discord">
              {t("common.remove", "הסר")}
            </Button>
          ) : (
            <div className="space-y-2">
              <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Webhook URL</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showDiscord ? "text" : "password"}
                    value={discordUrl}
                    onChange={e => setDiscordUrl(e.target.value)}
                    placeholder="https://discord.com/api/webhooks/..."
                    className="bg-secondary/50 border-border text-sm h-9 font-mono text-left pe-9"
                    dir="ltr"
                    data-testid="input-discord-url"
                  />
                  <button onClick={() => setShowDiscord(!showDiscord)} className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showDiscord ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <Button size="sm" onClick={saveDiscord} disabled={!discordUrl || saveMutation.isPending} className="h-9 text-xs" data-testid="button-save-discord">
                  {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : t("common.save", "שמור")}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="bg-secondary/30 p-4 rounded-lg border border-border">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-[#0088cc] flex items-center justify-center">
                <span className="text-white text-xs font-bold">T</span>
              </div>
              <span className="text-sm font-medium">Telegram</span>
            </div>
            {status?.hasTelegram && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-emerald-500 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> {t("common.connected", "מחובר")}
                </span>
                <span className="text-[10px] text-muted-foreground font-mono" dir="ltr">Chat: {status.telegramChatId}</span>
              </div>
            )}
          </div>
          {status?.hasTelegram ? (
            <Button variant="outline" size="sm" onClick={removeTelegram} className="h-7 text-[11px]" data-testid="button-remove-telegram">
              {t("common.remove", "הסר")}
            </Button>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Bot Token</Label>
                  <div className="relative">
                    <Input
                      type={showTelegram ? "text" : "password"}
                      value={telegramToken}
                      onChange={e => setTelegramToken(e.target.value)}
                      placeholder="123456:ABC-DEF..."
                      className="bg-secondary/50 border-border text-sm h-9 font-mono text-left pe-9"
                      dir="ltr"
                      data-testid="input-telegram-token"
                    />
                    <button onClick={() => setShowTelegram(!showTelegram)} className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showTelegram ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Chat ID</Label>
                  <Input
                    value={telegramChat}
                    onChange={e => setTelegramChat(e.target.value)}
                    placeholder="-100123456789"
                    className="bg-secondary/50 border-border text-sm h-9 font-mono text-left"
                    dir="ltr"
                    data-testid="input-telegram-chat"
                  />
                </div>
              </div>
              <Button size="sm" onClick={saveTelegram} disabled={!telegramToken || !telegramChat || saveMutation.isPending} className="h-9 text-xs" data-testid="button-save-telegram">
                {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : t("common.save", "שמור")}
              </Button>
            </div>
          )}
        </div>

        {(status?.hasDiscord || status?.hasTelegram) && (
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setTestResult(null); testMutation.mutate(); }}
              disabled={testMutation.isPending}
              className="h-8 text-xs gap-1.5"
              data-testid="button-test-webhook"
            >
              {testMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              {t("settings.testWebhook", "שלח בדיקה")}
            </Button>
            {testResult && (
              <div className="flex items-center gap-2 text-xs">
                {testResult.discord && <span className="text-emerald-500 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Discord</span>}
                {testResult.telegram && <span className="text-emerald-500 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Telegram</span>}
                {testResult.errors.map((err, i) => (
                  <span key={i} className="text-red-500 flex items-center gap-1"><XCircle className="w-3 h-3" /> {err}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
