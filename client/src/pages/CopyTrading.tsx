import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BLOCKED_COPY_STATUSES } from "@shared/schema";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useIsDemo } from "@/hooks/useDemoMode";
import { useCurrency } from "@/hooks/useCurrency";
import { useTranslation } from "react-i18next";
import { isRTL } from "@/i18n";
import {
  Copy, Plus, Play, Pause, Trash2, Loader2,
  CheckCircle2, XCircle, Clock, AlertTriangle, Users,
  ChevronDown, ChevronUp, Zap,
  Activity, BarChart3, ArrowRight
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";


interface Account {
  id: number;
  accountId: string;
  name: string;
  firm: string;
  balance: number;
  size: number;
  integrationConnectionId: number | null;
  maxDrawdown: number | null;
  externalAccountId?: string;
  status?: string;
}

interface Follower {
  id: number;
  groupId: number;
  followerAccountId: number;
  followerConnectionId: number | null;
  multiplier: number;
  sizingMode: string;
  maxPositionSize: number | null;
  allowedSymbols: string[] | null;
  enabled: boolean;
  status: string;
  lastError: string | null;
  account?: Account | null;
  maxSlippagePercent: number | null;
  maxSlippageTicks: number | null;
}

interface CopyGroup {
  id: number;
  userId: number;
  name: string;
  masterAccountId: number;
  masterConnectionId: number | null;
  status: string;
  pollIntervalMs: number;
  followers: Follower[];
  masterAccount: Account | null;
  orderCount: number;
  maxSlippagePercent: number | null;
  maxSlippageTicks: number | null;
  providerKey?: string | null;
  webhookToken?: string | null;
  defaultOrderType?: string | null;
  defaultTimeInForce?: string | null;
}

interface CopyOrder {
  id: number;
  groupId: number;
  followerAccountId: number;
  masterOrderRef: string | null;
  followerOrderRef: string | null;
  symbol: string;
  side: string;
  quantity: number;
  price: number | null;
  status: string;
  errorMessage: string | null;
  latencyMs: number | null;
  orderType: string | null;
  timeInForce: string | null;
  slippageTicks: number | null;
  slippageDollars: number | null;
  createdAt: string;
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: any }> = {
  active: { color: "text-emerald-400", bg: "bg-emerald-500/10", icon: CheckCircle2 },
  paused: { color: "text-amber-400", bg: "bg-amber-500/10", icon: Pause },
  idle: { color: "text-neutral-400", bg: "bg-neutral-500/10", icon: Clock },
  synced: { color: "text-blue-400", bg: "bg-blue-500/10", icon: CheckCircle2 },
  error: { color: "text-red-400", bg: "bg-red-500/10", icon: XCircle },
  paused_risk: { color: "text-orange-400", bg: "bg-orange-500/10", icon: AlertTriangle },
  partial: { color: "text-cyan-400", bg: "bg-cyan-500/10", icon: Activity },
  skipped_slippage: { color: "text-orange-400", bg: "bg-orange-500/10", icon: AlertTriangle },
  connected: { color: "text-emerald-400", bg: "bg-emerald-500/10", icon: CheckCircle2 },
  pending: { color: "text-amber-400", bg: "bg-amber-500/10", icon: Clock },
  sync_failed: { color: "text-orange-400", bg: "bg-orange-500/10", icon: AlertTriangle },
};

function getStatusLabel(status: string, t: any): string {
  const map: Record<string, string> = {
    active: t("copyTrading.active"),
    paused: t("copyTrading.paused"),
    idle: t("copyTrading.idle"),
    synced: t("copyTrading.synced"),
    error: t("copyTrading.error"),
    paused_risk: t("copyTrading.pausedRisk"),
    filled: t("copyTrading.filled"),
    pending: t("copyTrading.pending"),
    sent: t("copyTrading.sent"),
    failed: t("copyTrading.failed"),
    rejected: t("copyTrading.rejected"),
    partial: t("copyTrading.partial"),
    skipped_slippage: t("copyTrading.skippedSlippage"),
    risk_blocked: t("copyTrading.riskBlocked", { defaultValue: "Risk Blocked" }),
    connected: t("copyTrading.connected", { defaultValue: "Connected" }),
    sync_failed: t("status.sync_failed", { defaultValue: "failed" }),
  };
  return map[status] || status;
}

function formatCompactAmount(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatExactAmount(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export default function CopyTrading() {
  const { t, i18n } = useTranslation();
  const rtl = isRTL(i18n.language);
  const { toast } = useToast();
  const isDemo = useIsDemo();
  const queryClient = useQueryClient();
  const { formatCurrency } = useCurrency();

  const [expandedGroup, setExpandedGroup] = useState<number | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showAddFollower, setShowAddFollower] = useState<number | null>(null);
  const [showOrderLog, setShowOrderLog] = useState<number | null>(null);

  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMasterAccount, setNewGroupMasterAccount] = useState("");

  const [newFollowerAccounts, setNewFollowerAccounts] = useState<Set<string>>(new Set());
  const [newFollowerMultiplier, setNewFollowerMultiplier] = useState("1");
  const [newFollowerSizingMode, setNewFollowerSizingMode] = useState("proportional");

  const groupsQuery = useQuery<CopyGroup[]>({
    queryKey: ["/api/v1/copy-trading/groups"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });
  const groups: CopyGroup[] = Array.isArray(groupsQuery.data) ? groupsQuery.data : [];
  const groupsLoading = groupsQuery.isLoading;

  const accountsQuery = useQuery<Account[]>({
    queryKey: ["/api/v1/accounts"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });
  const accounts: Account[] = Array.isArray(accountsQuery.data) ? accountsQuery.data : [];

  const engineStatusQuery = useQuery<{ activeGroups: number; groupIds: number[] }>({
    queryKey: ["/api/v1/copy-trading/engine-status"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    refetchInterval: 10000,
  });
  const engineStatus = engineStatusQuery.data;

  const connectedAccounts = accounts.filter(a => a.integrationConnectionId != null);

  const createGroupMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/v1/copy-trading/groups", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/copy-trading/groups"] });
      setShowCreateDialog(false);
      resetCreateForm();
      toast({ title: t("copyTrading.createGroup"), description: "✓" });
    },
    onError: (err: any) => {
      toast({ title: t("copyTrading.error"), description: String(err?.message || err), variant: "destructive" });
    },
  });

  const toggleGroupMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await apiRequest("PATCH", `/api/v1/copy-trading/groups/${id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/copy-trading/groups"] });
    },
    onError: (err: any) => {
      toast({ title: t("copyTrading.toggleError"), description: String(err?.message || err), variant: "destructive" });
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/v1/copy-trading/groups/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/copy-trading/groups"] });
      toast({ title: t("copyTrading.delete"), description: "✓" });
    },
    onError: (err: any) => {
      toast({ title: t("copyTrading.deleteError"), description: String(err?.message || err), variant: "destructive" });
    },
  });


  const addFollowerMutation = useMutation({
    mutationFn: async ({ groupId, data }: { groupId: number; data: any }) => {
      const res = await apiRequest("POST", `/api/v1/copy-trading/groups/${groupId}/followers`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/copy-trading/groups"] });
      setShowAddFollower(null);
      resetFollowerForm();
      toast({ title: t("copyTrading.addFollower"), description: "✓" });
    },
    onError: (err: any) => {
      toast({ title: t("copyTrading.error"), description: String(err?.message || err), variant: "destructive" });
    },
  });

  const toggleFollowerMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => {
      const res = await apiRequest("PATCH", `/api/v1/copy-trading/followers/${id}`, { enabled });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/copy-trading/groups"] });
    },
  });

  const deleteFollowerMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/v1/copy-trading/followers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/copy-trading/groups"] });
    },
  });


  const flattenMutation = useMutation({
    mutationFn: async (groupId: number) => {
      const res = await apiRequest("POST", `/api/v1/copy-trading/groups/${groupId}/flatten`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/copy-trading/groups"] });
      toast({ title: "Panic Flatten", description: "✓" });
    },
    onError: (err: any) => {
      toast({ title: t("copyTrading.error"), description: String(err?.message || err), variant: "destructive" });
    },
  });

  function resetCreateForm() {
    setNewGroupName("");
    setNewGroupMasterAccount("");
  }

  function resetFollowerForm() {
    setNewFollowerAccounts(new Set());
    setNewFollowerMultiplier("1");
    setNewFollowerSizingMode("proportional");
  }

  const handleCreateGroup = () => {
    if (!newGroupName || !newGroupMasterAccount) return;
    createGroupMutation.mutate({
      name: newGroupName,
      masterAccountId: parseInt(newGroupMasterAccount),
      masterConnectionId: null,
      pollIntervalMs: 5000,
      maxSlippagePercent: null,
      maxSlippageTicks: null,
    });
  };

  const handleAddFollower = (groupId: number) => {
    if (newFollowerAccounts.size === 0) return;
    const followers = Array.from(newFollowerAccounts).map(accId => ({
      followerAccountId: parseInt(accId),
      followerConnectionId: null,
      multiplier: parseFloat(newFollowerMultiplier) || 1,
      sizingMode: newFollowerSizingMode,
      maxPositionSize: null,
      allowedSymbols: null,
      maxSlippagePercent: null,
      maxSlippageTicks: null,
    }));
    followers.forEach(f => {
      addFollowerMutation.mutate({ groupId, data: f });
    });
  };

  const isAutoSizing = newFollowerSizingMode === "proportional";

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6" dir={rtl ? "rtl" : "ltr"}>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                <Copy className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-500" />
                {t("copyTrading.title")}
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground">{t("copyTrading.subtitle")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setShowCreateDialog(true)}
              disabled={isDemo || connectedAccounts.length === 0}
              size="icon"
              className="h-8 w-8"
              data-testid="btn-create-group"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {engineStatus && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Activity className="w-3.5 h-3.5" />
            <span>{t("copyTrading.engineStatus")}: </span>
            <Badge variant="outline" className={engineStatus.activeGroups > 0 ? "text-emerald-400" : "text-neutral-400"}>
              {t("copyTrading.activeGroups")}: {engineStatus.activeGroups}
            </Badge>
          </div>
        )}

        {groupsLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : groups.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <Copy className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-30" />
              <h3 className="text-lg font-semibold mb-1">{t("copyTrading.noGroups")}</h3>
              <p className="text-sm text-muted-foreground">{t("copyTrading.noGroupsDesc")}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => {
              const statusCfg = STATUS_CONFIG[group.status] || STATUS_CONFIG.paused;
              const StatusIcon = statusCfg.icon;
              const isExpanded = expandedGroup === group.id;
              const groupFollowers = Array.isArray(group.followers) ? group.followers : [];

              return (
                <Card key={group.id} className="overflow-hidden" data-testid={`card-group-${group.id}`}>
                  <CardContent className="p-0">
                    <div
                      className="flex flex-wrap items-center justify-between p-3 sm:p-4 cursor-pointer hover:bg-secondary/30 transition-colors gap-2"
                      onClick={() => setExpandedGroup(isExpanded ? null : group.id)}
                      data-testid={`btn-expand-group-${group.id}`}
                    >
                      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                        <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg ${statusCfg.bg} flex items-center justify-center flex-shrink-0`}>
                          <StatusIcon className={`w-4 h-4 sm:w-5 sm:h-5 ${statusCfg.color}`} />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-sm sm:text-base truncate">{group.name}</h3>
                          <p className="text-xs text-muted-foreground truncate" dir="ltr">
                            {t("copyTrading.masterAccount")}: {group.masterAccount?.name || `#${group.masterAccountId}`}
                            {(() => {
                              const mAcc = accounts.find(a => a.id === group.masterAccountId);
                              if (!mAcc) return null;
                              return (
                                <span className={`ms-1.5 font-mono ${mAcc.balance < mAcc.size ? 'text-red-400' : 'text-emerald-400'}`}>
                                  {`{${formatExactAmount(mAcc.balance)}}`}
                                </span>
                              );
                            })()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 sm:gap-3">
                        <Badge variant="outline" className={`text-xs ${statusCfg.color}`}>
                          {getStatusLabel(group.status, t)}
                        </Badge>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Users className="w-3.5 h-3.5" />
                          <span>{groupFollowers.length}</span>
                        </div>
                        <div className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground">
                          <Activity className="w-3.5 h-3.5" />
                          <span>{group.orderCount || 0}</span>
                        </div>
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-border">
                        <div className="p-4 space-y-4">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <h4 className="text-sm font-semibold flex items-center gap-2">
                              <Users className="w-4 h-4 text-indigo-500" />
                              {t("copyTrading.followerAccounts")} ({groupFollowers.length})
                            </h4>
                            <div className="flex items-center gap-2">
                              <Button size="sm" variant="outline" disabled={isDemo} onClick={() => setShowAddFollower(group.id)} data-testid={`btn-add-follower-${group.id}`}>
                                <Plus className="w-3.5 h-3.5 me-1" />
                                {t("copyTrading.addFollower")}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setShowOrderLog(showOrderLog === group.id ? null : group.id)} data-testid={`btn-order-log-${group.id}`}>
                                <BarChart3 className="w-3.5 h-3.5 me-1" />
                                {t("copyTrading.orderLog")}
                              </Button>
                            </div>
                          </div>

                          {groupFollowers.length > 0 ? (
                            <div className="space-y-2">
                              {groupFollowers.map((follower) => {
                                const fStatus = STATUS_CONFIG[follower.status] || STATUS_CONFIG.idle;
                                const FIcon = fStatus.icon;
                                const fAccount = accounts.find(a => a.id === follower.followerAccountId);
                                const masterAcc = accounts.find(a => a.id === group.masterAccountId);
                                return (
                                  <div key={follower.id} className="bg-secondary/20 rounded-lg p-3" data-testid={`card-follower-${follower.id}`}>
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                                        <FIcon className={`w-4 h-4 flex-shrink-0 ${fStatus.color}`} />
                                        <div>
                                          <p className="text-sm font-medium" dir="ltr">
                                            {fAccount?.name || `#${follower.followerAccountId}`}
                                            {fAccount && (
                                              <span className={`ms-1.5 font-mono text-xs ${fAccount.balance < fAccount.size ? 'text-red-400' : 'text-emerald-400'}`}>
                                                {`{${formatExactAmount(fAccount.balance)}}`}
                                              </span>
                                            )}
                                          </p>
                                          <p className="text-xs text-muted-foreground">
                                            {follower.sizingMode === "proportional"
                                              ? `${t("copyTrading.automatic", { defaultValue: "אוטומטי" })} (${fAccount?.size ? `${(fAccount.size / 1000).toFixed(0)}K` : "?"} / ${masterAcc?.size ? `${(masterAcc.size / 1000).toFixed(0)}K` : "?"})`
                                              : `${t("copyTrading.fixedMultiplier")} x${follower.multiplier}`}
                                          </p>
                                          {follower.lastError && (
                                            <p className="text-xs text-red-400 mt-0.5">{follower.lastError}</p>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <Switch
                                          checked={!!follower.enabled}
                                          onCheckedChange={(checked) => toggleFollowerMutation.mutate({ id: follower.id, enabled: !!checked })}
                                          data-testid={`switch-follower-${follower.id}`}
                                        />
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-7 px-2 text-red-400"
                                          disabled={isDemo}
                                          onClick={() => deleteFollowerMutation.mutate(follower.id)}
                                          data-testid={`btn-delete-follower-${follower.id}`}
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </Button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground text-center py-4">אין חשבונות עוקבים</p>
                          )}

                          {showOrderLog === group.id && (
                            <OrderLogSection groupId={group.id} t={t} formatCurrency={formatCurrency} />
                          )}

                          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
                            <Button
                              size="sm"
                              variant={group.status === "active" ? "outline" : "default"}
                              disabled={isDemo}
                              onClick={() => {
                                const followers = Array.isArray(group.followers) ? group.followers : [];
                                if (group.status !== "active" && followers.length === 0) {
                                  setExpandedGroup(group.id);
                                  setShowAddFollower(group.id);
                                  return;
                                }
                                toggleGroupMutation.mutate({
                                  id: group.id,
                                  status: group.status === "active" ? "paused" : "active",
                                });
                              }}
                              data-testid={`btn-toggle-group-${group.id}`}
                            >
                              {group.status === "active" ? (
                                <><Pause className="w-3.5 h-3.5 me-1" />{t("copyTrading.pause")}</>
                              ) : (
                                <><Play className="w-3.5 h-3.5 me-1" />{t("copyTrading.activate")}</>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="bg-red-600/20 text-red-400 hover:bg-red-600/40"
                              disabled={isDemo}
                              onClick={() => {
                                if (confirm(t("copyTrading.deleteConfirm"))) {
                                  deleteGroupMutation.mutate(group.id);
                                }
                              }}
                              data-testid={`btn-delete-group-${group.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5 me-1" />
                              {t("copyTrading.delete")}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="bg-orange-600/20 text-orange-400 hover:bg-orange-600/40"
                              disabled={isDemo || flattenMutation.isPending}
                              onClick={() => {
                                if (confirm("PANIC FLATTEN — Close ALL follower positions?")) {
                                  flattenMutation.mutate(group.id);
                                }
                              }}
                              data-testid={`btn-panic-flatten-${group.id}`}
                            >
                              {flattenMutation.isPending ? (
                                <Loader2 className="w-3.5 h-3.5 me-1 animate-spin" />
                              ) : (
                                <AlertTriangle className="w-3.5 h-3.5 me-1" />
                              )}
                              PANIC FLATTEN
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <Dialog open={showCreateDialog} onOpenChange={(open) => { setShowCreateDialog(open); if (!open) resetCreateForm(); }}>
          <DialogContent className="max-w-md" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Copy className="w-5 h-5 text-indigo-500" />
                {t("copyTrading.createGroup")}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <Label>{t("copyTrading.groupName")}</Label>
                <Input
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder={t("copyTrading.groupNamePlaceholder")}
                  data-testid="input-group-name"
                />
              </div>
              <div>
                <Label>{t("copyTrading.masterAccount")}</Label>
                <select
                  value={newGroupMasterAccount}
                  onChange={(e) => setNewGroupMasterAccount(e.target.value)}
                  className="flex h-9 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  data-testid="select-master-account"
                  dir="ltr"
                >
                  <option value="" disabled>{t("copyTrading.selectMaster")}</option>
                  {connectedAccounts.map((acc) => {
                    const isFailed = !!(acc.status && BLOCKED_COPY_STATUSES.has(acc.status));
                    return (
                      <option key={acc.id} value={String(acc.id)} disabled={isFailed}>
                        {isFailed ? `[FAILED] ` : ''}{acc.name || acc.accountId}{acc.size != null ? ` (${formatCompactAmount(acc.size)})` : ''}{acc.balance != null ? ` {${formatExactAmount(acc.balance)}}` : ''}
                      </option>
                    );
                  })}
                </select>
                {connectedAccounts.length === 0 && (
                  <p className="text-xs text-amber-400 mt-1">{t("copyTrading.needsBrokerConnection", { defaultValue: "חבר ברוקר בעמוד אינטגרציות כדי ליצור קבוצה." })}</p>
                )}
              </div>
              <Button
                onClick={handleCreateGroup}
                disabled={isDemo || !newGroupName || !newGroupMasterAccount || createGroupMutation.isPending}
                className="w-full"
                data-testid="btn-submit-create-group"
              >
                {createGroupMutation.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                {t("copyTrading.createGroup")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={showAddFollower !== null} onOpenChange={(open) => { if (!open) { setShowAddFollower(null); resetFollowerForm(); } }}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-500" />
                {t("copyTrading.addFollower")}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <Label className="text-sm font-semibold">{t("copyTrading.selectFollower")}</Label>
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto border rounded-lg p-2">
                  {connectedAccounts
                    .filter(acc => {
                      const currentGroup = groups.find(g => g.id === showAddFollower);
                      if (!currentGroup) return true;
                      if (acc.id === currentGroup.masterAccountId) return false;
                      const cFollowers = Array.isArray(currentGroup.followers) ? currentGroup.followers : [];
                      return !cFollowers.some(f => f.followerAccountId === acc.id);
                    })
                    .map((acc) => {
                      const isFailed = !!(acc.status && BLOCKED_COPY_STATUSES.has(acc.status));
                      return (
                        <label key={acc.id} className={`flex items-center gap-2 p-1.5 rounded ${isFailed ? 'opacity-50 cursor-not-allowed' : 'hover:bg-secondary/30 cursor-pointer'}`}>
                          <Checkbox
                            checked={newFollowerAccounts.has(String(acc.id))}
                            disabled={isFailed}
                            onCheckedChange={(checked) => {
                              const next = new Set(newFollowerAccounts);
                              if (checked) next.add(String(acc.id)); else next.delete(String(acc.id));
                              setNewFollowerAccounts(next);
                            }}
                          />
                          <span className="text-sm" dir="ltr">{isFailed ? '[FAILED] ' : ''}{acc.name || acc.accountId}</span>
                          {acc.size != null && <span className="text-xs text-muted-foreground">({formatCompactAmount(acc.size)})</span>}
                          {acc.balance != null && (
                            <span className={`text-xs font-mono ${acc.balance < acc.size ? 'text-red-400' : 'text-emerald-400'}`}>
                              {`{${formatExactAmount(acc.balance)}}`}
                            </span>
                          )}
                        </label>
                      );
                    })}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("copyTrading.selected")}: {newFollowerAccounts.size}
                </p>
              </div>

              <div>
                <Label className="text-sm">{t("copyTrading.sizingMode")}</Label>
                <select
                  value={newFollowerSizingMode}
                  onChange={(e) => setNewFollowerSizingMode(e.target.value)}
                  className="flex h-9 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  data-testid="select-sizing-mode"
                >
                  <option value="proportional">{t("copyTrading.automatic", { defaultValue: "אוטומטי (פרופורציונלי)" })}</option>
                  <option value="fixed">{t("copyTrading.fixedMultiplier")}</option>
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  {isAutoSizing ? t("copyTrading.proportionalHint") : t("copyTrading.fixedHint")}
                </p>
              </div>

              {!isAutoSizing && (
                <div>
                  <Label className="text-sm">{t("copyTrading.multiplier")}</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={newFollowerMultiplier}
                    onChange={(e) => setNewFollowerMultiplier(e.target.value)}
                    dir="ltr"
                    data-testid="input-multiplier"
                  />
                </div>
              )}

              <Button
                onClick={() => showAddFollower !== null && handleAddFollower(showAddFollower)}
                disabled={isDemo || newFollowerAccounts.size === 0 || addFollowerMutation.isPending}
                className="w-full"
                data-testid="btn-submit-add-follower"
              >
                {addFollowerMutation.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                {t("copyTrading.addFollower")} ({newFollowerAccounts.size})
              </Button>
            </div>
          </DialogContent>
        </Dialog>

      </div>
    </div>
  );
}

function OrderLogSection({ groupId, t, formatCurrency }: { groupId: number; t: any; formatCurrency: (v: number) => string }) {
  const ordersQuery = useQuery<CopyOrder[]>({
    queryKey: [`/api/v1/copy-trading/groups/${groupId}/orders`],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });
  const orders: CopyOrder[] = Array.isArray(ordersQuery.data) ? ordersQuery.data : [];

  if (orders.length === 0) {
    return (
      <div className="text-center py-4 text-sm text-muted-foreground">
        {t("copyTrading.noOrders")}
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs" dir="ltr">
          <thead className="bg-secondary/30">
            <tr>
              <th className="text-start p-2">{t("copyTrading.time")}</th>
              <th className="text-start p-2">{t("copyTrading.symbol")}</th>
              <th className="text-start p-2">{t("copyTrading.side")}</th>
              <th className="text-end p-2">{t("copyTrading.quantity")}</th>
              <th className="text-end p-2">{t("copyTrading.price")}</th>
              <th className="text-end p-2">{t("copyTrading.latency")}</th>
              <th className="text-start p-2">{t("copyTrading.status")}</th>
            </tr>
          </thead>
          <tbody>
            {orders.slice(0, 50).map((order) => {
              const sCfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
              return (
                <tr key={order.id} className="border-t border-border/50 hover:bg-secondary/10">
                  <td className="p-2 text-muted-foreground">{new Date(order.createdAt).toLocaleTimeString()}</td>
                  <td className="p-2 font-mono font-semibold">{order.symbol}</td>
                  <td className={`p-2 font-semibold ${order.side?.toLowerCase() === "buy" ? "text-emerald-400" : "text-red-400"}`}>
                    {order.side?.toLowerCase() === "buy" ? t("copyTrading.buy") : t("copyTrading.sell")}
                  </td>
                  <td className="p-2 text-end font-mono">{order.quantity}</td>
                  <td className="p-2 text-end font-mono">{order.price != null ? order.price.toFixed(2) : "—"}</td>
                  <td className="p-2 text-end font-mono">{order.latencyMs != null ? `${order.latencyMs}ms` : "—"}</td>
                  <td className="p-2">
                    <Badge variant="outline" className={`text-[10px] ${sCfg.color}`}>
                      {getStatusLabel(order.status, t)}
                    </Badge>
                    {order.errorMessage && (
                      <p className="text-red-400 text-[10px] mt-0.5 max-w-[120px] truncate" title={order.errorMessage}>{order.errorMessage}</p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
