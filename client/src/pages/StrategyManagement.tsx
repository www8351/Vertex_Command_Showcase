import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import { isRTL } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Target, TrendingUp, TrendingDown, BarChart3
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface Playbook {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  userId: number;
}

export default function StrategyManagement() {
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? "rtl" : "ltr";
  const { formatCurrency } = useCurrency();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [filter, setFilter] = useState<"all" | "verified" | "manual">("all");

  const playbooksQuery = useQuery<Playbook[]>({
    queryKey: ["/api/v1/playbooks"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; description: string }) => {
      const res = await apiRequest("POST", "/api/v1/playbooks", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/playbooks"] });
      setShowCreate(false);
      setNewName("");
      setNewDesc("");
      toast({ title: t("strategy.created", { defaultValue: "אסטרטגיה נוצרה" }) });
    },
  });

  const playbooks = playbooksQuery.data || [];

  return (
    <div className="min-h-screen bg-background" dir={dir}>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold" data-testid="text-strategy-title">
            {t("strategy.title", { defaultValue: "ניהול אסטרטגיות" })}
          </h1>
          <Button size="sm" onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700" data-testid="btn-add-strategy">
            <Plus className="w-4 h-4 me-1" />
            {t("strategy.addStrategy", { defaultValue: "הוסף אסטרטגיה" })}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(["all", "verified", "manual"] as const).map(f => (
            <Badge
              key={f}
              variant={filter === f ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setFilter(f)}
            >
              {f === "all" ? t("trades.allJournals", { defaultValue: "כל היומנים" })
                : f === "verified" ? t("trades.verified", { defaultValue: "מאומת" })
                : t("trades.manual", { defaultValue: "ידני" })}
            </Badge>
          ))}
          <div className="flex-1" />
          <span className="text-xs text-muted-foreground">{t("trades.allAccounts", { defaultValue: "כל החשבונות" })}</span>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-1">{t("strategy.tradingStrategies", { defaultValue: "אסטרטגיות מסחר" })}</h2>
          <p className="text-sm text-muted-foreground mb-4">{t("strategy.desc", { defaultValue: "צור ועקוב אחרי אסטרטגיות המסחר שלך" })}</p>
        </div>

        {playbooks.length === 0 ? (
          <Card className="bg-card border-border">
            <CardContent className="p-6 space-y-4">
              <div className="text-sm text-muted-foreground">
                {t("strategy.exampleTitle", { defaultValue: "דוגמה לאסטרטגיה" })}
              </div>
              <p className="text-xs text-muted-foreground">{t("strategy.noStrategies", { defaultValue: "עדיין לא נוצרו אסטרטגיות" })}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <p className="text-muted-foreground">{t("trades.wins", { defaultValue: "זכיות" })}</p>
                  <p className="font-semibold">0</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t("trades.losses", { defaultValue: "הפסדים" })}</p>
                  <p className="font-semibold">0</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t("strategy.total", { defaultValue: "סה\"כ" })}</p>
                  <p className="font-semibold">0</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t("strategy.totalPnl", { defaultValue: "P&L כולל" })}</p>
                  <p className="font-semibold">{formatCurrency(0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {playbooks.map(pb => (
              <Card key={pb.id} className="bg-card border-border hover:border-indigo-500/20 transition-colors" data-testid={`card-strategy-${pb.id}`}>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-lg" style={{ backgroundColor: (pb.color || '#6366f1') + '20' }}>
                        {pb.icon || '🎯'}
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold">{pb.name}</h3>
                        {pb.description && <p className="text-xs text-muted-foreground">{pb.description}</p>}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <p className="text-muted-foreground">{t("trades.wins", { defaultValue: "זכיות" })}</p>
                      <p className="font-semibold">0</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t("trades.losses", { defaultValue: "הפסדים" })}</p>
                      <p className="font-semibold">0</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t("strategy.total", { defaultValue: "סה\"כ" })}</p>
                      <p className="font-semibold">0</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t("strategy.totalPnl", { defaultValue: "P&L כולל" })}</p>
                      <p className="font-semibold">{formatCurrency(0)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogContent className="max-w-sm" dir={dir}>
            <DialogHeader>
              <DialogTitle>{t("strategy.addStrategy", { defaultValue: "הוסף אסטרטגיה" })}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <Label className="text-sm">{t("strategy.name", { defaultValue: "שם" })}</Label>
                <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder={t("strategy.namePlaceholder", { defaultValue: "למשל: Breakout" })} data-testid="input-strategy-name" />
              </div>
              <div>
                <Label className="text-sm">{t("strategy.description", { defaultValue: "תיאור" })}</Label>
                <Input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder={t("strategy.descPlaceholder", { defaultValue: "תיאור קצר של האסטרטגיה" })} data-testid="input-strategy-desc" />
              </div>
              <Button
                onClick={() => newName && createMutation.mutate({ name: newName, description: newDesc })}
                disabled={!newName || createMutation.isPending}
                className="w-full bg-indigo-600 hover:bg-indigo-700"
                data-testid="btn-submit-strategy"
              >
                {t("strategy.create", { defaultValue: "צור אסטרטגיה" })}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

      </div>
    </div>
  );
}
