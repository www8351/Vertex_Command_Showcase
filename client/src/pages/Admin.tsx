import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getQueryFn, getCsrfToken } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { isRTL } from "@/i18n";
import {
  Users, CreditCard, Activity, BarChart3,
  Loader2, CheckCircle2, XCircle, Shield, Wifi, ShieldCheck, ShieldOff, RefreshCw,
  Trash2, Pause, Play, AlertTriangle, Server, Gift, UserCheck, DollarSign, Clock, Lock, Unlock,
  Database, Download, HardDrive, Info,
  ShieldAlert, ChevronDown, Eye
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { motion } from "framer-motion";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/apiBase";

interface AdminUser {
  id: number; name: string; email: string; role: string;
  status: string; emailVerified: boolean;
  failedLoginAttempts: number; lockedUntil: string | null;
  totpEnabled: boolean;
}

interface BillingOverview {
  userId: number; userName: string; email: string;
  planName: string; planKey: string; status: string;
  amount: number; billingCycle: string | null;
}

interface Metrics {
  totalUsers: number; verifiedUsers: number;
  activeSubscriptions: number; trialSubscriptions: number;
  totalMRR: number;
}

interface ProviderHealth {
  id: number; key: string; name: string; active: boolean; status: string;
}

interface AdminAccount {
  id: number; accountId: string; accountName: string; userId: number;
  userName: string; userEmail: string; status: string; balance: number;
  dataSource: string; brokerKey: string; brokerName: string; connectionId: number | null;
}

interface BackupFile {
  filename: string; size: number; createdAt: string; status: string;
}

interface BackupData {
  backups: BackupFile[];
  status: {
    lastBackup: BackupFile | null;
    nextScheduled: string | null;
    retentionDays: number;
    schedulerActive: boolean;
  };
}

interface SecurityEventItem {
  id: number; eventType: string; severity: string; userId: number | null;
  ipAddress: string | null; details: Record<string, any> | null;
  createdAt: string; userName: string | null; userEmail: string | null;
}

interface SecurityEventsResponse {
  events: SecurityEventItem[]; total: number; limit: number; offset: number;
}

interface LinkedUserEntry {
  id: number; primaryUserId: number; linkedUserId: number; createdAt: string;
  primaryUser: { name: string; email: string; role: string } | null;
  linkedUser: { name: string; email: string; role: string } | null;
}

export default function AdminPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? 'rtl' : 'ltr';
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmRoleChange, setConfirmRoleChange] = useState<{ userId: number; name: string; newRole: string } | null>(null);
  const [confirmPlanChange, setConfirmPlanChange] = useState<{ userId: number; name: string; planKey: string; planName: string } | null>(null);
  const [selectedAccounts, setSelectedAccounts] = useState<Set<number>>(new Set());
  const [accountBrokerFilter, setAccountBrokerFilter] = useState<string>("all");
  const [confirmAccountAction, setConfirmAccountAction] = useState<{ type: 'delete' | 'suspend' | 'activate' | 'bulk-delete' | 'broker-delete'; ids?: number[]; brokerKey?: string; brokerName?: string; accountName?: string; all?: boolean } | null>(null);
  const [secSeverityFilter, setSecSeverityFilter] = useState<string>("all");
  const [secTypeFilter, setSecTypeFilter] = useState<string>("all");
  const [secLimit, setSecLimit] = useState(50);
  const [linkPrimaryId, setLinkPrimaryId] = useState("");
  const [linkLinkedId, setLinkLinkedId] = useState("");

  interface PlanInfo { id: number; key: string; name: string; monthlyPrice: number; yearlyPrice: number; active: boolean; }
  const { data: plans = [] } = useQuery<PlanInfo[]>({
    queryKey: ["/api/v1/billing/plans"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: user?.role === "admin",
  });

  const planChangeMutation = useMutation({
    mutationFn: async ({ userId, planKey }: { userId: number; planKey: string }) => {
      const token = await getCsrfToken();
      const hdrs: Record<string, string> = { "Content-Type": "application/json" };
      if (token) hdrs["x-csrf-token"] = token;
      const res = await fetch(apiUrl(`/api/v1/admin/users/${userId}/plan`), {
        method: "PATCH",
        headers: hdrs,
        credentials: "include",
        body: JSON.stringify({ planKey }),
      });
      if (!res.ok) {
        let msg = "Failed";
        try { const data = await res.json(); msg = data.message || msg; } catch {}
        throw new Error(msg);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/billing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/metrics"] });
      toast({ title: t('admin.planChanged'), description: t('admin.planChangedDesc') });
      setConfirmPlanChange(null);
    },
    onError: (err: Error) => {
      toast({ title: t('common.error'), description: err.message, variant: "destructive" });
      setConfirmPlanChange(null);
    },
  });

  const roleChangeMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: number; role: string }) => {
      const token = await getCsrfToken();
      const hdrs: Record<string, string> = { "Content-Type": "application/json" };
      if (token) hdrs["x-csrf-token"] = token;
      const res = await fetch(apiUrl(`/api/v1/admin/users/${userId}/role`), {
        method: "PATCH",
        headers: hdrs,
        credentials: "include",
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        let msg = "Failed";
        try { const data = await res.json(); msg = data.message || msg; } catch {}
        throw new Error(msg);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/users"] });
      toast({ title: t('admin.roleChanged'), description: t('admin.roleChangedDesc') });
      setConfirmRoleChange(null);
    },
    onError: (err: Error) => {
      toast({ title: t('common.error'), description: err.message, variant: "destructive" });
      setConfirmRoleChange(null);
    },
  });

  const unlockMutation = useMutation({
    mutationFn: async (userId: number) => {
      const token = await getCsrfToken();
      const hdrs: Record<string, string> = { "Content-Type": "application/json" };
      if (token) hdrs["x-csrf-token"] = token;
      const res = await fetch(apiUrl(`/api/v1/admin/users/${userId}/unlock`), {
        method: "POST",
        headers: hdrs,
        credentials: "include",
      });
      if (!res.ok) {
        let msg = "Failed";
        try { const data = await res.json(); msg = data.message || msg; } catch {}
        throw new Error(msg);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/users"] });
      toast({ title: t('admin.accountUnlocked'), description: t('admin.accountUnlockedDesc') });
    },
    onError: (err: Error) => {
      toast({ title: t('common.error'), description: err.message, variant: "destructive" });
    },
  });

  const { data: users = [], isLoading: usersLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/v1/admin/users"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: user?.role === "admin",
  });

  const { data: billing = [] } = useQuery<BillingOverview[]>({
    queryKey: ["/api/v1/admin/billing"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: user?.role === "admin",
  });

  const { data: metrics } = useQuery<Metrics>({
    queryKey: ["/api/v1/admin/metrics"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: user?.role === "admin",
  });

  const { data: providerHealth = [] } = useQuery<ProviderHealth[]>({
    queryKey: ["/api/v1/admin/integrations/health"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: user?.role === "admin",
  });

  interface SystemStatus {
    overall: string;
    services: { name: string; status: string; detail?: string; latency?: number }[];
    uptime: number;
    timestamp: string;
  }
  const { data: systemStatus } = useQuery<SystemStatus>({
    queryKey: ["/api/v1/system/status"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/v1/system/status"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: user?.role === "admin",
    refetchInterval: 60000,
  });

  const { data: adminAccounts = [] } = useQuery<AdminAccount[]>({
    queryKey: ["/api/v1/admin/accounts"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: user?.role === "admin",
  });

  interface AffiliateStats {
    stats: { totalReferralCodes: number; totalReferrals: number; totalConverted: number; totalRewardsGiven: number; pendingRewards: number };
    topReferrers: { userId: number; name: string; email: string; code: string; totalReferred: number; totalConverted: number; totalReward: number }[];
    recentReferrals: { id: number; referrerName: string; referredName: string; referredEmail: string; status: string; rewardAmount: number; rewardApplied: boolean; createdAt: string }[];
  }
  const { data: affiliateData } = useQuery<AffiliateStats>({
    queryKey: ["/api/v1/admin/affiliate/stats"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: user?.role === "admin",
  });

  const { data: backupData, isLoading: backupsLoading } = useQuery<BackupData>({
    queryKey: ["/api/v1/admin/backups"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: user?.role === "admin",
  });

  const backupMutation = useMutation({
    mutationFn: async () => {
      const token = await getCsrfToken();
      const hdrs: Record<string, string> = {};
      if (token) hdrs["x-csrf-token"] = token;
      const res = await fetch(apiUrl("/api/v1/admin/backup"), {
        method: "POST", headers: hdrs, credentials: "include",
      });
      if (!res.ok) {
        let msg = "Backup failed";
        try { const data = await res.json(); msg = data.message || msg; } catch {}
        throw new Error(msg);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/backups"] });
      toast({ title: t('admin.backupStarted'), description: t('admin.backupStartedDesc') });
    },
    onError: (err: Error) => {
      toast({ title: t('admin.backupFailed'), description: err.message || t('admin.backupFailedDesc'), variant: "destructive" });
    },
  });

  const { data: linkedUsers = [], isLoading: linkedUsersLoading } = useQuery<LinkedUserEntry[]>({
    queryKey: ["/api/v1/admin/linked-users"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: user?.role === "admin",
  });

  const createLinkMutation = useMutation({
    mutationFn: async ({ primaryUserId, linkedUserId }: { primaryUserId: number; linkedUserId: number }) => {
      const token = await getCsrfToken();
      const hdrs: Record<string, string> = { "Content-Type": "application/json" };
      if (token) hdrs["x-csrf-token"] = token;
      const res = await fetch(apiUrl("/api/v1/admin/linked-users"), {
        method: "POST", headers: hdrs, credentials: "include",
        body: JSON.stringify({ primaryUserId, linkedUserId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to link users");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/linked-users"] });
      setLinkPrimaryId("");
      setLinkLinkedId("");
      toast({ title: "Users linked", description: "The accounts are now linked and share data." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to link", description: err.message, variant: "destructive" });
    },
  });

  const deleteLinkMutation = useMutation({
    mutationFn: async (id: number) => {
      const token = await getCsrfToken();
      const hdrs: Record<string, string> = {};
      if (token) hdrs["x-csrf-token"] = token;
      const res = await fetch(apiUrl(`/api/v1/admin/linked-users/${id}`), {
        method: "DELETE", headers: hdrs, credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to unlink");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/linked-users"] });
      toast({ title: "Link removed", description: "The accounts are no longer linked." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to unlink", description: err.message, variant: "destructive" });
    },
  });

  const mergeDuplicatesMutation = useMutation({
    mutationFn: async ({ primaryUserId, linkedUserId }: { primaryUserId: number; linkedUserId: number }) => {
      const token = await getCsrfToken();
      const hdrs: Record<string, string> = { "Content-Type": "application/json" };
      if (token) hdrs["x-csrf-token"] = token;
      const res = await fetch(apiUrl("/api/v1/admin/linked-users/merge-duplicates"), {
        method: "POST", headers: hdrs, credentials: "include",
        body: JSON.stringify({ primaryUserId, linkedUserId }),
      });
      if (!res.ok) throw new Error("Merge failed");
      return res.json();
    },
    onSuccess: (data: { mergedAccounts: number; deletedAccounts: number; deletedConnections: number }) => {
      toast({ title: "Merge complete", description: `Merged ${data.mergedAccounts} accounts, removed ${data.deletedConnections} duplicate connections.` });
    },
    onError: (err: Error) => {
      toast({ title: "Merge failed", description: err.message, variant: "destructive" });
    },
  });

  const secQueryParams = new URLSearchParams();
  if (secSeverityFilter !== "all") secQueryParams.set("severity", secSeverityFilter);
  if (secTypeFilter !== "all") secQueryParams.set("eventType", secTypeFilter);
  secQueryParams.set("limit", String(secLimit));

  const { data: securityEventsData, isLoading: secEventsLoading } = useQuery<SecurityEventsResponse>({
    queryKey: ["/api/v1/admin/security-events", secSeverityFilter, secTypeFilter, secLimit],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/v1/admin/security-events?${secQueryParams.toString()}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: user?.role === "admin",
  });

  const applyRewardMutation = useMutation({
    mutationFn: async (referralId: number) => {
      const token = await getCsrfToken();
      const hdrs: Record<string, string> = {};
      if (token) hdrs["x-csrf-token"] = token;
      const res = await fetch(apiUrl(`/api/v1/admin/affiliate/apply-reward/${referralId}`), {
        method: "POST", headers: hdrs, credentials: "include",
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/affiliate/stats"] });
      toast({ title: t('affiliate.applied'), description: t('affiliate.reward') + " " + t('affiliate.applied').toLowerCase() });
    },
    onError: () => {
      toast({ title: t('common.error'), description: "Failed to apply reward", variant: "destructive" });
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async (id: number) => {
      const token = await getCsrfToken();
      const hdrs: Record<string, string> = {};
      if (token) hdrs["x-csrf-token"] = token;
      const res = await fetch(apiUrl(`/api/v1/admin/accounts/${id}`), { method: "DELETE", headers: hdrs, credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/metrics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/trades/monthly-pnl"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/trades/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/withdrawals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/balance-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/integrations/connections"] });
      toast({ title: t('admin.accountDeleted'), description: t('admin.accountDeletedDesc') });
      setConfirmAccountAction(null);
    },
    onError: () => {
      toast({ title: t('common.error'), description: t('admin.accountDeleteFailed'), variant: "destructive" });
      setConfirmAccountAction(null);
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (body: { ids?: number[]; brokerKey?: string; all?: boolean }) => {
      const token = await getCsrfToken();
      const hdrs: Record<string, string> = { "Content-Type": "application/json" };
      if (token) hdrs["x-csrf-token"] = token;
      const res = await fetch(apiUrl("/api/v1/admin/accounts/bulk-delete"), {
        method: "POST", credentials: "include",
        headers: hdrs,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/metrics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/trades/monthly-pnl"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/trades/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/withdrawals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/balance-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/integrations/connections"] });
      toast({ title: t('admin.accountsDeleted'), description: t('admin.accountsDeletedDesc', { count: data.deletedCount }) });
      setConfirmAccountAction(null);
      setSelectedAccounts(new Set());
    },
    onError: () => {
      toast({ title: t('common.error'), description: t('admin.accountDeleteFailed'), variant: "destructive" });
      setConfirmAccountAction(null);
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const token = await getCsrfToken();
      const hdrs: Record<string, string> = { "Content-Type": "application/json" };
      if (token) hdrs["x-csrf-token"] = token;
      const res = await fetch(apiUrl(`/api/v1/admin/accounts/${id}/status`), {
        method: "PATCH", credentials: "include",
        headers: hdrs,
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/accounts"] });
      toast({ title: t('admin.statusUpdated'), description: t('admin.statusUpdatedDesc') });
      setConfirmAccountAction(null);
    },
    onError: () => {
      toast({ title: t('common.error'), description: t('admin.statusUpdateFailed'), variant: "destructive" });
      setConfirmAccountAction(null);
    },
  });

  const brokerKeys = [...new Set(adminAccounts.map(a => a.brokerKey))];
  const filteredAccounts = accountBrokerFilter === "all" ? adminAccounts : adminAccounts.filter(a => a.brokerKey === accountBrokerFilter);
  const allFilteredSelected = filteredAccounts.length > 0 && filteredAccounts.every(a => selectedAccounts.has(a.id));

  function formatBackupSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (user?.role !== "admin") {
    return (
      <div dir={dir} className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Card className="bg-[#1a1a1a] border-neutral-800 p-8 text-center">
          <Shield className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-neutral-200 mb-2">{t('admin.restricted')}</h2>
          <p className="text-neutral-500">{t('admin.restrictedDesc')}</p>
        </Card>
      </div>
    );
  }

  if (usersLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div dir={dir} className="min-h-screen bg-[#0a0a0a] text-neutral-200">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between rtl:flex-row-reverse mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-600/20 flex items-center justify-center">
              <Shield className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-neutral-100" data-testid="text-page-title">{t('admin.title')}</h1>
              <p className="text-sm text-neutral-500">{t('admin.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
          </div>
        </div>

        {metrics && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
            {[
              { label: t('admin.totalUsers'), value: metrics.totalUsers, icon: Users, color: 'text-blue-400' },
              { label: t('admin.verifiedUsers'), value: metrics.verifiedUsers, icon: CheckCircle2, color: 'text-emerald-400' },
              { label: t('admin.activeSubscriptions'), value: metrics.activeSubscriptions, icon: CreditCard, color: 'text-indigo-400' },
              { label: t('admin.trialSubscriptions'), value: metrics.trialSubscriptions, icon: Activity, color: 'text-amber-400' },
              { label: t('admin.mrr'), value: `$${metrics.totalMRR}`, icon: BarChart3, color: 'text-emerald-400' },
            ].map((m, idx) => (
              <motion.div key={idx} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
                <Card className="bg-[#1a1a1a] border-neutral-800" data-testid={`card-metric-${idx}`}>
                  <CardContent className="p-4">
                    <m.icon className={`w-5 h-5 ${m.color} mb-2`} />
                    <div className="text-2xl font-bold text-neutral-100">{m.value}</div>
                    <div className="text-xs text-neutral-500">{m.label}</div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div>
            <h2 className="text-lg font-semibold text-neutral-200 mb-3">{t('admin.users')} ({users.length})</h2>
            <Card className="bg-[#1a1a1a] border-neutral-800">
              <CardContent className="p-0 max-h-[400px] overflow-y-auto">
                <div className="divide-y divide-neutral-800">
                  {users.map(u => (
                    <div key={u.id} className="flex items-center justify-between p-3" data-testid={`row-user-${u.id}`}>
                      <div>
                        <div className="text-sm font-medium text-neutral-200">{u.name}</div>
                        <div className="text-xs text-neutral-500" dir="ltr">{u.email}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {u.lockedUntil && new Date(u.lockedUntil) > new Date() && (
                          <Badge className="bg-orange-500/10 text-orange-400 border-orange-500/20" data-testid={`badge-locked-${u.id}`}>
                            <Lock className="w-3 h-3 mr-1" />
                            {t('admin.locked')}
                          </Badge>
                        )}
                        {u.emailVerified ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-400" />
                        )}
                        {u.totpEnabled && (
                          <span className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-1.5 py-0.5 rounded" data-testid={`badge-2fa-${u.id}`}>2FA</span>
                        )}
                        <Badge className={u.role === 'admin' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20'}>
                          {u.role === 'admin' ? t('admin.roleAdmin') : t('admin.roleUser')}
                        </Badge>
                        {u.lockedUntil && new Date(u.lockedUntil) > new Date() && (
                          <button
                            onClick={() => unlockMutation.mutate(u.id)}
                            className="p-1.5 rounded-md transition-colors hover:bg-orange-500/10 text-orange-400"
                            title={t('admin.unlockAccount')}
                            data-testid={`button-unlock-${u.id}`}
                          >
                            <Unlock className="w-4 h-4" />
                          </button>
                        )}
                        {u.id !== user?.id && (
                          <button
                            onClick={() => setConfirmRoleChange({ userId: u.id, name: u.name, newRole: u.role === 'admin' ? 'user' : 'admin' })}
                            className={`p-1.5 rounded-md transition-colors ${u.role === 'admin' ? 'hover:bg-red-500/10 text-red-400' : 'hover:bg-emerald-500/10 text-emerald-400'}`}
                            title={u.role === 'admin' ? t('admin.demoteUser') : t('admin.promoteAdmin')}
                            data-testid={`button-role-toggle-${u.id}`}
                          >
                            {u.role === 'admin' ? <ShieldOff className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-neutral-200 mb-3">{t('admin.subscriptions')}</h2>
            <Card className="bg-[#1a1a1a] border-neutral-800">
              <CardContent className="p-0 max-h-[400px] overflow-y-auto">
                <div className="divide-y divide-neutral-800">
                  {billing.map(b => (
                    <div key={b.userId} className="flex items-center justify-between p-3" data-testid={`row-billing-${b.userId}`}>
                      <div>
                        <div className="text-sm font-medium text-neutral-200">{b.userName}</div>
                        <div className="text-xs text-neutral-500">{b.email}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Select
                          value={b.planKey}
                          onValueChange={(newPlanKey) => {
                            if (newPlanKey !== b.planKey) {
                              const selectedPlan = plans.find(p => p.key === newPlanKey);
                              setConfirmPlanChange({
                                userId: b.userId,
                                name: b.userName,
                                planKey: newPlanKey,
                                planName: selectedPlan?.name || newPlanKey,
                              });
                            }
                          }}
                        >
                          <SelectTrigger className="h-7 w-[100px] bg-transparent border-neutral-700 text-xs text-indigo-400" data-testid={`select-plan-${b.userId}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-[#2a2a2a] border-neutral-700">
                            {plans.map(p => (
                              <SelectItem key={p.key} value={p.key} className="text-neutral-200 text-xs">
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Badge className={
                          b.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                          b.status === 'trialing' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                          'bg-neutral-500/10 text-neutral-400 border-neutral-500/20'
                        }>
                          {b.status === 'active' ? t('admin.statusActive') : b.status === 'trialing' ? t('admin.statusTrialing') : b.status}
                        </Badge>
                        {b.amount > 0 && <span className="text-xs text-neutral-500">${b.amount}/{b.billingCycle === 'yearly' ? t('billing.perYear') : t('billing.perMonth')}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-neutral-200">{t('admin.accountManagement')} ({adminAccounts.length})</h2>
            <div className="flex items-center gap-2">
              <Select value={accountBrokerFilter} onValueChange={setAccountBrokerFilter}>
                <SelectTrigger className="h-8 w-[140px] bg-transparent border-neutral-700 text-xs text-neutral-300" data-testid="select-broker-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#2a2a2a] border-neutral-700">
                  <SelectItem value="all" className="text-neutral-200 text-xs">{t('admin.allBrokers')}</SelectItem>
                  {brokerKeys.map(k => (
                    <SelectItem key={k} value={k} className="text-neutral-200 text-xs">
                      {adminAccounts.find(a => a.brokerKey === k)?.brokerName || k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedAccounts.size > 0 && (
                <Button
                  size="sm" variant="outline"
                  className="border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs gap-1"
                  onClick={() => setConfirmAccountAction({ type: 'bulk-delete', ids: [...selectedAccounts] })}
                  data-testid="button-bulk-delete-selected"
                >
                  <Trash2 className="w-3 h-3" /> {t('admin.deleteSelected')} ({selectedAccounts.size})
                </Button>
              )}
              {accountBrokerFilter !== "all" && (
                <Button
                  size="sm" variant="outline"
                  className="border-orange-500/30 text-orange-400 hover:bg-orange-500/10 text-xs gap-1"
                  onClick={() => {
                    const brokerName = adminAccounts.find(a => a.brokerKey === accountBrokerFilter)?.brokerName || accountBrokerFilter;
                    setConfirmAccountAction({ type: 'broker-delete', brokerKey: accountBrokerFilter, brokerName });
                  }}
                  data-testid="button-delete-by-broker"
                >
                  <Trash2 className="w-3 h-3" /> {t('admin.deleteBroker', { broker: adminAccounts.find(a => a.brokerKey === accountBrokerFilter)?.brokerName || accountBrokerFilter })}
                </Button>
              )}
              <Button
                size="sm" variant="outline"
                className="border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs gap-1"
                onClick={() => setConfirmAccountAction({ type: 'bulk-delete', all: true })}
                disabled={adminAccounts.length === 0}
                data-testid="button-delete-all"
              >
                <Trash2 className="w-3 h-3" /> {t('admin.deleteAll')}
              </Button>
            </div>
          </div>

          <Card className="bg-[#1a1a1a] border-neutral-800">
            <CardContent className="p-0 max-h-[400px] overflow-y-auto">
              {filteredAccounts.length === 0 ? (
                <div className="p-8 text-center text-neutral-500 text-sm">{t('admin.noAccounts')}</div>
              ) : (
                <div className="divide-y divide-neutral-800">
                  <div className="flex items-center gap-3 px-3 py-2 bg-neutral-800/30 text-xs text-neutral-500 font-medium">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={() => {
                        if (allFilteredSelected) {
                          setSelectedAccounts(new Set());
                        } else {
                          setSelectedAccounts(new Set(filteredAccounts.map(a => a.id)));
                        }
                      }}
                      className="accent-indigo-500"
                      data-testid="checkbox-select-all"
                    />
                    <span className="flex-1">{t('admin.accountCol')}</span>
                    <span className="w-24">{t('admin.brokerCol')}</span>
                    <span className="w-24">{t('admin.userCol')}</span>
                    <span className="w-20">{t('admin.statusCol')}</span>
                    <span className="w-24 text-center">{t('admin.actionsCol')}</span>
                  </div>
                  {filteredAccounts.map(a => (
                    <div key={a.id} className="flex items-center gap-3 px-3 py-2" data-testid={`row-account-${a.id}`}>
                      <input
                        type="checkbox"
                        checked={selectedAccounts.has(a.id)}
                        onChange={() => {
                          const next = new Set(selectedAccounts);
                          next.has(a.id) ? next.delete(a.id) : next.add(a.id);
                          setSelectedAccounts(next);
                        }}
                        className="accent-indigo-500"
                        data-testid={`checkbox-account-${a.id}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-neutral-200 truncate">{a.accountId}</div>
                        <div className="text-xs text-neutral-500">${Number(a.balance || 0).toLocaleString()}</div>
                      </div>
                      <Badge className="w-24 justify-center bg-neutral-500/10 text-neutral-400 border-neutral-500/20 text-xs">{a.brokerName}</Badge>
                      <div className="w-24 truncate text-xs text-neutral-400">{a.userName}</div>
                      <Badge className={`w-20 justify-center text-xs ${a.status === 'suspended' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
                        {a.status === 'suspended' ? t('admin.suspended') : t('admin.healthy')}
                      </Badge>
                      <div className="w-24 flex items-center justify-center gap-1">
                        <button
                          onClick={() => setConfirmAccountAction({
                            type: a.status === 'suspended' ? 'activate' : 'suspend',
                            ids: [a.id],
                            accountName: a.accountId,
                          })}
                          className={`p-1.5 rounded-md transition-colors ${a.status === 'suspended' ? 'hover:bg-emerald-500/10 text-emerald-400' : 'hover:bg-amber-500/10 text-amber-400'}`}
                          title={a.status === 'suspended' ? t('admin.activate') : t('admin.suspend')}
                          data-testid={`button-suspend-${a.id}`}
                        >
                          {a.status === 'suspended' ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => setConfirmAccountAction({ type: 'delete', ids: [a.id], accountName: a.accountId })}
                          className="p-1.5 rounded-md transition-colors hover:bg-red-500/10 text-red-400"
                          title={t('admin.deleteAccount')}
                          data-testid={`button-delete-account-${a.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <h2 className="text-lg font-semibold text-neutral-200 mb-3">{t('admin.providerHealth')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {providerHealth.map(p => (
            <Card key={p.id} className="bg-[#1a1a1a] border-neutral-800" data-testid={`card-provider-health-${p.key}`}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wifi className="w-4 h-4 text-indigo-400" />
                  <span className="text-sm text-neutral-200">{p.name}</span>
                </div>
                <Badge className={p.status === 'operational' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}>
                  {p.status === 'operational' ? t('admin.operational') : p.status}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mb-8 mt-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-neutral-200 flex items-center gap-2">
              <Database className="w-5 h-5 text-indigo-400" />
              {t('admin.backupRestore')}
            </h2>
            <div className="flex items-center gap-2">
              {backupData?.status && (
                <Badge className={backupData.status.schedulerActive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20'} data-testid="badge-scheduler-status">
                  {backupData.status.schedulerActive ? t('admin.schedulerActive') : t('admin.schedulerInactive')}
                </Badge>
              )}
              {backupData?.status && (
                <Badge className="bg-neutral-500/10 text-neutral-400 border-neutral-500/20" data-testid="badge-retention">
                  {t('admin.retentionDays', { days: backupData.status.retentionDays })}
                </Badge>
              )}
              <Button
                size="sm"
                variant="outline"
                className="gap-2 border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10"
                onClick={() => backupMutation.mutate()}
                disabled={backupMutation.isPending}
                data-testid="button-trigger-backup"
              >
                {backupMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {t('admin.triggerBackup')}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <Card className="bg-[#1a1a1a] border-neutral-800" data-testid="card-last-backup">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <HardDrive className="w-4 h-4 text-indigo-400" />
                  <span className="text-sm font-medium text-neutral-300">{t('admin.lastBackup')}</span>
                </div>
                {backupData?.status?.lastBackup ? (
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-neutral-200">{backupData.status.lastBackup.filename}</span>
                      {backupData.status.lastBackup.status === "success" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-red-400" />
                      )}
                    </div>
                    <div className="text-xs text-neutral-500">{new Date(backupData.status.lastBackup.createdAt).toLocaleString()}</div>
                  </div>
                ) : (
                  <div className="text-sm text-neutral-500">{t('admin.noBackupsYet')}</div>
                )}
              </CardContent>
            </Card>
            <Card className="bg-[#1a1a1a] border-neutral-800" data-testid="card-next-scheduled">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-medium text-neutral-300">{t('admin.nextScheduled')}</span>
                </div>
                {backupData?.status?.nextScheduled ? (
                  <div className="text-sm text-neutral-200">{new Date(backupData.status.nextScheduled).toLocaleString()}</div>
                ) : (
                  <div className="text-sm text-neutral-500">—</div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="bg-[#1a1a1a] border-neutral-800 mb-3">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold text-neutral-200 mb-3">{t('admin.availableBackups')}</h3>
              {backupsLoading ? (
                <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-indigo-400" /></div>
              ) : !backupData?.backups?.length ? (
                <div className="text-center text-sm text-neutral-500 py-4">{t('admin.noBackups')}</div>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center gap-3 px-3 py-2 bg-neutral-800/30 text-xs text-neutral-500 font-medium rounded">
                    <span className="flex-1">{t('admin.backupFilename')}</span>
                    <span className="w-24 text-center">{t('admin.backupSize')}</span>
                    <span className="w-40 text-center">{t('admin.backupDate')}</span>
                  </div>
                  {backupData.backups.map((b, idx) => (
                    <div key={b.filename} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-neutral-800/20" data-testid={`row-backup-${idx}`}>
                      <span className="flex-1 text-sm text-neutral-200 truncate font-mono">{b.filename}</span>
                      <span className="w-24 text-center text-xs text-neutral-400">{formatBackupSize(b.size)}</span>
                      <span className="w-40 text-center text-xs text-neutral-400">{new Date(b.createdAt).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-[#1a1a1a] border-neutral-800" data-testid="card-restore-guide">
            <CardContent className="p-4 flex items-start gap-3">
              <Info className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <div>
                <h3 className="text-sm font-semibold text-neutral-200">{t('admin.restoreGuide')}</h3>
                <p className="text-xs text-neutral-400 mt-1 font-mono">{t('admin.restoreGuideDesc')}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mb-8 mt-6">
          <h2 className="text-lg font-semibold text-neutral-200 mb-3 flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-400" />
            Linked Accounts
          </h2>

          <Card className="bg-[#1a1a1a] border-neutral-800 mb-3" data-testid="card-linked-users-form">
            <CardContent className="p-4">
              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="text-xs text-neutral-400 block mb-1">Primary User ID</label>
                  <input
                    type="number"
                    value={linkPrimaryId}
                    onChange={e => setLinkPrimaryId(e.target.value)}
                    className="w-24 bg-neutral-900 border border-neutral-700 rounded px-2 py-1.5 text-sm text-neutral-200"
                    data-testid="input-link-primary-id"
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-400 block mb-1">Linked User ID</label>
                  <input
                    type="number"
                    value={linkLinkedId}
                    onChange={e => setLinkLinkedId(e.target.value)}
                    className="w-24 bg-neutral-900 border border-neutral-700 rounded px-2 py-1.5 text-sm text-neutral-200"
                    data-testid="input-link-linked-id"
                  />
                </div>
                <Button
                  size="sm"
                  className="gap-1 bg-indigo-600 hover:bg-indigo-700 text-white"
                  disabled={!linkPrimaryId || !linkLinkedId || createLinkMutation.isPending}
                  onClick={() => createLinkMutation.mutate({ primaryUserId: parseInt(linkPrimaryId), linkedUserId: parseInt(linkLinkedId) })}
                  data-testid="button-create-link"
                >
                  {createLinkMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Users className="w-3 h-3" />}
                  Link Users
                </Button>
              </div>
            </CardContent>
          </Card>

          {linkedUsersLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>
          ) : linkedUsers.length === 0 ? (
            <Card className="bg-[#1a1a1a] border-neutral-800">
              <CardContent className="p-4 text-center text-sm text-neutral-500">No linked accounts configured</CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {linkedUsers.map(link => (
                <Card key={link.id} className="bg-[#1a1a1a] border-neutral-800" data-testid={`card-linked-user-${link.id}`}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div>
                        <span className="text-sm text-neutral-200 font-medium">{link.primaryUser?.name || `User #${link.primaryUserId}`}</span>
                        <span className="text-xs text-neutral-500 ml-1">({link.primaryUser?.email})</span>
                      </div>
                      <span className="text-neutral-600">↔</span>
                      <div>
                        <span className="text-sm text-neutral-200 font-medium">{link.linkedUser?.name || `User #${link.linkedUserId}`}</span>
                        <span className="text-xs text-neutral-500 ml-1">({link.linkedUser?.email})</span>
                      </div>
                      <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs">Linked</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                        onClick={() => mergeDuplicatesMutation.mutate({ primaryUserId: link.primaryUserId, linkedUserId: link.linkedUserId })}
                        disabled={mergeDuplicatesMutation.isPending}
                        data-testid={`button-merge-${link.id}`}
                      >
                        {mergeDuplicatesMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        Merge Duplicates
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
                        onClick={() => deleteLinkMutation.mutate(link.id)}
                        disabled={deleteLinkMutation.isPending}
                        data-testid={`button-unlink-${link.id}`}
                      >
                        {deleteLinkMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                        Unlink
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {(() => {
          const depService = systemStatus?.services.find(s => s.name === "dependency_health");
          if (!depService) return null;
          const statusColor = depService.status === "operational"
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
            : depService.status === "degraded"
            ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
            : "bg-red-500/10 text-red-400 border-red-500/20";
          const statusLabel = depService.status === "operational" ? t('admin.operational') : depService.status === "degraded" ? t('help.statusDegraded', 'Warning') : t('help.statusDown', 'Critical');
          return (
            <>
              <h2 className="text-lg font-semibold text-neutral-200 mb-3 mt-6 flex items-center gap-2">
                <Shield className="w-5 h-5 text-indigo-400" />
                {t('help.statusService.dependency_health', 'Dependency Health')}
              </h2>
              <Card className="bg-[#1a1a1a] border-neutral-800" data-testid="card-dependency-health">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Shield className="w-5 h-5 text-indigo-400" />
                    <div>
                      <span className="text-sm text-neutral-200 font-medium">{t('help.statusService.dependency_health', 'Dependency Health')}</span>
                      {depService.detail && (
                        <p className="text-xs text-neutral-400 mt-0.5">{depService.detail}</p>
                      )}
                    </div>
                  </div>
                  <Badge className={statusColor}>
                    {statusLabel}
                  </Badge>
                </CardContent>
              </Card>
            </>
          );
        })()}

        <div className="mb-8 mt-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-neutral-200 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-red-400" />
              {t('admin.securityEvents')}
            </h2>
            <div className="flex items-center gap-2">
              <Select value={secSeverityFilter} onValueChange={(v) => { setSecSeverityFilter(v); setSecLimit(50); }}>
                <SelectTrigger className="h-8 w-[140px] bg-transparent border-neutral-700 text-xs text-neutral-300" data-testid="select-severity-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#2a2a2a] border-neutral-700">
                  <SelectItem value="all" className="text-neutral-200 text-xs">{t('admin.severityAll')}</SelectItem>
                  <SelectItem value="info" className="text-neutral-200 text-xs">{t('admin.severityInfo')}</SelectItem>
                  <SelectItem value="warning" className="text-neutral-200 text-xs">{t('admin.severityWarning')}</SelectItem>
                  <SelectItem value="critical" className="text-neutral-200 text-xs">{t('admin.severityCritical')}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={secTypeFilter} onValueChange={(v) => { setSecTypeFilter(v); setSecLimit(50); }}>
                <SelectTrigger className="h-8 w-[180px] bg-transparent border-neutral-700 text-xs text-neutral-300" data-testid="select-event-type-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#2a2a2a] border-neutral-700">
                  <SelectItem value="all" className="text-neutral-200 text-xs">{t('admin.eventTypeAll')}</SelectItem>
                  <SelectItem value="login_success" className="text-neutral-200 text-xs">{t('admin.eventLoginSuccess')}</SelectItem>
                  <SelectItem value="login_failed" className="text-neutral-200 text-xs">{t('admin.eventLoginFailed')}</SelectItem>
                  <SelectItem value="account_locked" className="text-neutral-200 text-xs">{t('admin.eventAccountLocked')}</SelectItem>
                  <SelectItem value="account_unlocked" className="text-neutral-200 text-xs">{t('admin.eventAccountUnlocked')}</SelectItem>
                  <SelectItem value="password_reset_requested" className="text-neutral-200 text-xs">{t('admin.eventPasswordResetRequested')}</SelectItem>
                  <SelectItem value="password_reset_completed" className="text-neutral-200 text-xs">{t('admin.eventPasswordResetCompleted')}</SelectItem>
                  <SelectItem value="admin_role_change" className="text-neutral-200 text-xs">{t('admin.eventAdminRoleChange')}</SelectItem>
                  <SelectItem value="admin_plan_change" className="text-neutral-200 text-xs">{t('admin.eventAdminPlanChange')}</SelectItem>
                  <SelectItem value="csrf_failure" className="text-neutral-200 text-xs">{t('admin.eventCsrfFailure')}</SelectItem>
                  <SelectItem value="rate_limit_hit" className="text-neutral-200 text-xs">{t('admin.eventRateLimitHit')}</SelectItem>
                  <SelectItem value="register_success" className="text-neutral-200 text-xs">{t('admin.eventRegisterSuccess')}</SelectItem>
                  <SelectItem value="credential_access" className="text-neutral-200 text-xs">{t('admin.eventCredentialAccess')}</SelectItem>
                  <SelectItem value="2fa_enabled" className="text-neutral-200 text-xs">{t('admin.event2faEnabled')}</SelectItem>
                  <SelectItem value="2fa_disabled" className="text-neutral-200 text-xs">{t('admin.event2faDisabled')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Card className="bg-[#1a1a1a] border-neutral-800">
            <CardContent className="p-0 max-h-[500px] overflow-y-auto">
              {secEventsLoading ? (
                <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-indigo-500" /></div>
              ) : !securityEventsData?.events?.length ? (
                <div className="p-8 text-center text-neutral-500 text-sm" data-testid="text-no-security-events">{t('admin.noSecurityEvents')}</div>
              ) : (
                <>
                  <div className="divide-y divide-neutral-800">
                    {securityEventsData.events.map(ev => {
                      const severityColors: Record<string, string> = {
                        info: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
                        warning: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
                        critical: 'bg-red-500/10 text-red-400 border-red-500/20',
                      };
                      const eventTypeLabels: Record<string, string> = {
                        login_success: t('admin.eventLoginSuccess'),
                        login_failed: t('admin.eventLoginFailed'),
                        account_locked: t('admin.eventAccountLocked'),
                        account_unlocked: t('admin.eventAccountUnlocked'),
                        password_reset_requested: t('admin.eventPasswordResetRequested'),
                        password_reset_completed: t('admin.eventPasswordResetCompleted'),
                        admin_role_change: t('admin.eventAdminRoleChange'),
                        admin_plan_change: t('admin.eventAdminPlanChange'),
                        csrf_failure: t('admin.eventCsrfFailure'),
                        rate_limit_hit: t('admin.eventRateLimitHit'),
                        register_success: t('admin.eventRegisterSuccess'),
                        credential_access: t('admin.eventCredentialAccess'),
                        '2fa_enabled': t('admin.event2faEnabled'),
                        '2fa_disabled': t('admin.event2faDisabled'),
                      };
                      return (
                        <div key={ev.id} className={`flex items-center gap-3 px-4 py-3 ${ev.severity === 'critical' ? 'bg-red-500/5' : ''}`} data-testid={`row-security-event-${ev.id}`}>
                          <Badge className={`text-[10px] w-16 justify-center ${severityColors[ev.severity] || severityColors.info}`}>
                            {ev.severity === 'info' ? t('admin.severityInfo') : ev.severity === 'warning' ? t('admin.severityWarning') : t('admin.severityCritical')}
                          </Badge>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-neutral-200">{eventTypeLabels[ev.eventType] || ev.eventType}</div>
                            <div className="text-[11px] text-neutral-500 flex items-center gap-2 flex-wrap">
                              {ev.userName && <span>{ev.userName}</span>}
                              {ev.ipAddress && <span dir="ltr">{ev.ipAddress}</span>}
                              {ev.details && typeof ev.details === 'object' && Object.keys(ev.details).length > 0 && (
                                <span className="text-neutral-600 truncate max-w-[300px]">
                                  {Object.entries(ev.details as Record<string, any>).map(([k, v]) => `${k}: ${v}`).join(', ')}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-[11px] text-neutral-500 whitespace-nowrap" dir="ltr">
                            {new Date(ev.createdAt).toLocaleString()}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {securityEventsData.total > securityEventsData.events.length && (
                    <div className="p-3 text-center border-t border-neutral-800">
                      <div className="text-[11px] text-neutral-500 mb-2">
                        {t('admin.showing', { count: securityEventsData.events.length, total: securityEventsData.total })}
                      </div>
                      <Button
                        size="sm" variant="outline"
                        className="border-neutral-700 text-neutral-400 text-xs gap-1"
                        onClick={() => setSecLimit(prev => prev + 50)}
                        data-testid="button-load-more-events"
                      >
                        <ChevronDown className="w-3 h-3" /> {t('admin.loadMore')}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {affiliateData && (
          <>
            <h2 className="text-lg font-semibold text-neutral-200 mb-3 mt-6 flex items-center gap-2">
              <Gift className="w-5 h-5 text-indigo-400" />
              {t('affiliate.adminTitle')}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              {[
                { label: t('affiliate.totalCodes'), value: affiliateData.stats.totalReferralCodes, icon: Gift },
                { label: t('affiliate.totalReferrals'), value: affiliateData.stats.totalReferrals, icon: Users },
                { label: t('affiliate.totalConversions'), value: affiliateData.stats.totalConverted, icon: UserCheck },
                { label: t('affiliate.totalRewards'), value: `$${affiliateData.stats.totalRewardsGiven.toFixed(2)}`, icon: DollarSign },
                { label: t('affiliate.pendingRewards'), value: affiliateData.stats.pendingRewards, icon: Clock },
              ].map((s, i) => (
                <Card key={i} className="bg-[#1a1a1a] border-neutral-800" data-testid={`card-affiliate-stat-${i}`}>
                  <CardContent className="p-4 space-y-1">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <s.icon className="w-3.5 h-3.5" />
                      <span className="text-[11px]">{s.label}</span>
                    </div>
                    <p className="text-xl font-bold text-neutral-100">{s.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {affiliateData.topReferrers.length > 0 && (
              <Card className="bg-[#1a1a1a] border-neutral-800 mb-4">
                <CardContent className="p-4">
                  <h3 className="text-sm font-semibold text-neutral-200 mb-3">{t('affiliate.topReferrers')}</h3>
                  <div className="space-y-2">
                    {affiliateData.topReferrers.slice(0, 10).map((r, i) => (
                      <div key={r.userId} className="flex items-center justify-between py-2 px-3 rounded-lg bg-neutral-800/30" data-testid={`row-top-referrer-${r.userId}`}>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold text-indigo-400 w-5">#{i + 1}</span>
                          <div>
                            <p className="text-sm font-medium text-neutral-200">{r.name}</p>
                            <p className="text-[11px] text-neutral-500">{r.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-xs">
                          <span className="text-neutral-400">{r.totalReferred} {t('affiliate.totalReferred').toLowerCase()}</span>
                          <span className="text-emerald-400">{r.totalConverted} {t('affiliate.statusConverted').toLowerCase()}</span>
                          <Badge className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20">{r.code}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {affiliateData.recentReferrals.length > 0 && (
              <Card className="bg-[#1a1a1a] border-neutral-800">
                <CardContent className="p-4">
                  <h3 className="text-sm font-semibold text-neutral-200 mb-3">{t('affiliate.recentReferrals')}</h3>
                  <div className="space-y-2">
                    {affiliateData.recentReferrals.map(r => (
                      <div key={r.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-neutral-800/30" data-testid={`row-recent-referral-${r.id}`}>
                        <div className="flex items-center gap-4">
                          <div>
                            <p className="text-xs text-neutral-400">{t('affiliate.referrer')}: <span className="text-neutral-200">{r.referrerName}</span></p>
                            <p className="text-xs text-neutral-400">{t('affiliate.referred')}: <span className="text-neutral-200">{r.referredName}</span></p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {r.rewardAmount > 0 && (
                            <span className="text-xs font-semibold text-emerald-400">${r.rewardAmount.toFixed(2)}</span>
                          )}
                          <span className="text-[11px] text-neutral-500">{new Date(r.createdAt).toLocaleDateString()}</span>
                          <Badge className={r.status === 'converted' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}>
                            {r.status === 'converted' ? t('affiliate.statusConverted') : t('affiliate.statusRegistered')}
                          </Badge>
                          {r.status === 'converted' && !r.rewardApplied && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10"
                              onClick={() => applyRewardMutation.mutate(r.id)}
                              disabled={applyRewardMutation.isPending}
                              data-testid={`button-apply-reward-${r.id}`}
                            >
                              {applyRewardMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : t('affiliate.applyReward')}
                            </Button>
                          )}
                          {r.status === 'converted' && r.rewardApplied && (
                            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px]">
                              {t('affiliate.applied')}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {confirmAccountAction && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setConfirmAccountAction(null)}>
          <div className="bg-[#1a1a1a] border border-neutral-700 rounded-xl p-6 max-w-sm w-full mx-4 space-y-4" onClick={e => e.stopPropagation()} data-testid="dialog-confirm-account-action">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${confirmAccountAction.type === 'activate' ? 'bg-emerald-500/10' : confirmAccountAction.type === 'suspend' ? 'bg-amber-500/10' : 'bg-red-500/10'}`}>
                {confirmAccountAction.type === 'activate' ? <Play className="w-5 h-5 text-emerald-400" /> :
                  confirmAccountAction.type === 'suspend' ? <Pause className="w-5 h-5 text-amber-400" /> :
                  <AlertTriangle className="w-5 h-5 text-red-400" />}
              </div>
              <div>
                <h3 className="text-base font-semibold text-neutral-100">
                  {confirmAccountAction.type === 'activate' ? t('admin.confirmActivate') :
                    confirmAccountAction.type === 'suspend' ? t('admin.confirmSuspend') :
                    t('admin.confirmDelete')}
                </h3>
                {confirmAccountAction.accountName && <p className="text-xs text-neutral-500">{confirmAccountAction.accountName}</p>}
              </div>
            </div>
            <p className="text-sm text-neutral-400">
              {confirmAccountAction.type === 'activate' ? t('admin.confirmActivateDesc') :
                confirmAccountAction.type === 'suspend' ? t('admin.confirmSuspendDesc') :
                confirmAccountAction.type === 'broker-delete' ? t('admin.confirmBrokerDeleteDesc', { broker: confirmAccountAction.brokerName }) :
                confirmAccountAction.all ? t('admin.confirmDeleteAllDesc') :
                confirmAccountAction.ids && confirmAccountAction.ids.length > 1 ? t('admin.confirmBulkDeleteDesc', { count: confirmAccountAction.ids.length }) :
                t('admin.confirmDeleteDesc')}
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setConfirmAccountAction(null)} className="border-neutral-700 text-neutral-400" data-testid="button-cancel-account-action">
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                disabled={deleteAccountMutation.isPending || bulkDeleteMutation.isPending || statusMutation.isPending}
                onClick={() => {
                  if (confirmAccountAction.type === 'activate' || confirmAccountAction.type === 'suspend') {
                    statusMutation.mutate({ id: confirmAccountAction.ids![0], status: confirmAccountAction.type === 'suspend' ? 'suspended' : 'healthy' });
                  } else if (confirmAccountAction.type === 'delete' && confirmAccountAction.ids?.length === 1) {
                    deleteAccountMutation.mutate(confirmAccountAction.ids[0]);
                  } else if (confirmAccountAction.type === 'broker-delete') {
                    bulkDeleteMutation.mutate({ brokerKey: confirmAccountAction.brokerKey });
                  } else if (confirmAccountAction.all) {
                    bulkDeleteMutation.mutate({ all: true });
                  } else if (confirmAccountAction.ids) {
                    bulkDeleteMutation.mutate({ ids: confirmAccountAction.ids });
                  }
                }}
                className={confirmAccountAction.type === 'activate' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : confirmAccountAction.type === 'suspend' ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-red-600 hover:bg-red-700 text-white'}
                data-testid="button-confirm-account-action"
              >
                {(deleteAccountMutation.isPending || bulkDeleteMutation.isPending || statusMutation.isPending) ? <Loader2 className="w-4 h-4 animate-spin" /> : t('common.confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmPlanChange && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setConfirmPlanChange(null)}>
          <div className="bg-[#1a1a1a] border border-neutral-700 rounded-xl p-6 max-w-sm w-full mx-4 space-y-4" onClick={e => e.stopPropagation()} data-testid="dialog-confirm-plan">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-indigo-500/10">
                <RefreshCw className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-neutral-100">{t('admin.confirmPlanChange')}</h3>
                <p className="text-xs text-neutral-500">{confirmPlanChange.name}</p>
              </div>
            </div>
            <p className="text-sm text-neutral-400">
              {t('admin.confirmPlanChangeDesc', { planName: confirmPlanChange.planName })}
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setConfirmPlanChange(null)} className="border-neutral-700 text-neutral-400" data-testid="button-cancel-plan">
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                onClick={() => planChangeMutation.mutate({ userId: confirmPlanChange.userId, planKey: confirmPlanChange.planKey })}
                disabled={planChangeMutation.isPending}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
                data-testid="button-confirm-plan"
              >
                {planChangeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t('common.confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmRoleChange && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setConfirmRoleChange(null)}>
          <div className="bg-[#1a1a1a] border border-neutral-700 rounded-xl p-6 max-w-sm w-full mx-4 space-y-4" onClick={e => e.stopPropagation()} data-testid="dialog-confirm-role">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${confirmRoleChange.newRole === 'admin' ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                {confirmRoleChange.newRole === 'admin' ? <ShieldCheck className="w-5 h-5 text-emerald-400" /> : <ShieldOff className="w-5 h-5 text-red-400" />}
              </div>
              <div>
                <h3 className="text-base font-semibold text-neutral-100">{t('admin.confirmRoleChange')}</h3>
                <p className="text-xs text-neutral-500">{confirmRoleChange.name}</p>
              </div>
            </div>
            <p className="text-sm text-neutral-400">
              {confirmRoleChange.newRole === 'admin' ? t('admin.confirmPromote') : t('admin.confirmDemote')}
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setConfirmRoleChange(null)} className="border-neutral-700 text-neutral-400" data-testid="button-cancel-role">
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                onClick={() => roleChangeMutation.mutate({ userId: confirmRoleChange.userId, role: confirmRoleChange.newRole })}
                disabled={roleChangeMutation.isPending}
                className={confirmRoleChange.newRole === 'admin' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-red-600 hover:bg-red-700 text-white'}
                data-testid="button-confirm-role"
              >
                {roleChangeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t('common.confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
