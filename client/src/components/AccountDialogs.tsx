import { useState, useMemo, memo } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import { isRTL } from "@/i18n";
import { useLocation } from "wouter";
import { Plus, Pencil, CreditCard, Loader2, Lock, Crown, RefreshCw, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import FirmCombobox from "./FirmCombobox";
import type { Account as DbAccount, Firm, FirmTier } from "@shared/schema";

type AccountStage = 'phase1' | 'phase2' | 'funded' | 'payout';

const STAGE_KEYS: AccountStage[] = ['phase1', 'phase2', 'funded', 'payout'];

export const AddAccountDialog = memo(function AddAccountDialog() {
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? 'rtl' : 'ltr';
  const [, navigate] = useLocation();
  const { data: firmsList = [] } = useQuery<(Firm & { tiers: FirmTier[] })[]>({ queryKey: ["/api/v1/firms"] });

  const [isOpen, setIsOpen] = useState(false);
  const [planLimitError, setPlanLimitError] = useState<{ feature: string; requiredPlan: string } | null>(null);
  const [name, setName] = useState("");
  const [firm, setFirm] = useState("");
  const [tier, setTier] = useState("");
  const [stage, setStage] = useState<AccountStage>("phase1");
  const [size, setSize] = useState("");
  const [balance, setBalance] = useState("");
  const [target, setTarget] = useState("");
  const [maxDrawdown, setMaxDrawdown] = useState("");
  const [buffer, setBuffer] = useState("");
  const [consistencyRule, setConsistencyRule] = useState("");
  const [topDayProfit, setTopDayProfit] = useState("");
  const [drawdownType, setDrawdownType] = useState<"static" | "trailing">("static");
  const [trailingDrawdown, setTrailingDrawdown] = useState("");
  const [bufferEnabled, setBufferEnabled] = useState(true);

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/v1/accounts", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/firms"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/trading-priorities"] });
      setIsOpen(false);
      resetForm();
    },
    onError: (err: Error) => {
      if (err.message.startsWith('plan_limit:')) {
        const parts = err.message.split(':');
        setPlanLimitError({ feature: parts[1] || 'max_accounts', requiredPlan: parts[2] || 'pro' });
      }
    },
  });

  const selectedFirmTiers = useMemo(() => {
    const f = firmsList.find(f => f.name === firm);
    return f?.tiers || [];
  }, [firmsList, firm]);

  const resetForm = () => {
    setName(""); setFirm(""); setTier(""); setStage("phase1");
    setSize(""); setBalance(""); setTarget(""); setMaxDrawdown("");
    setBuffer(""); setConsistencyRule(""); setTopDayProfit("");
    setDrawdownType("static"); setTrailingDrawdown(""); setBufferEnabled(true);
    setPlanLimitError(null);
  };

  const handleSubmit = () => {
    const sizeNum = parseFloat(size);
    const balanceNum = parseFloat(balance);
    if (!name || !firm || isNaN(sizeNum) || isNaN(balanceNum)) return;
    setPlanLimitError(null);
    createMutation.mutate({
      accountId: `VX-${Math.floor(1000 + Math.random() * 9000)}`,
      name, firm, tier: tier || null, stage, size: sizeNum, balance: balanceNum,
      target: target ? parseFloat(target) : null,
      buffer: buffer ? parseFloat(buffer) : null,
      maxDrawdown: maxDrawdown ? parseFloat(maxDrawdown) : null,
      consistencyRule: consistencyRule ? parseFloat(consistencyRule) : null,
      topDayProfit: topDayProfit ? parseFloat(topDayProfit) : null,
      drawdownType,
      trailingDrawdown: trailingDrawdown ? parseFloat(trailingDrawdown) : null,
      bufferEnabled,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={o => { setIsOpen(o); if (!o) resetForm(); }}>
      <DialogTrigger asChild>
        <Button className="h-7 lg:h-8 text-[11px] lg:text-xs font-medium bg-foreground text-background hover:bg-foreground/90 rounded-full px-3 lg:px-4 shadow-sm"
          data-testid="button-add-account">
          <Plus className="w-3 h-3 lg:w-3.5 lg:h-3.5 ml-1" /> <span className="hidden sm:inline">{t('account.new')}</span><span className="sm:hidden">{t('account.newShort')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] bg-card border-border p-0 overflow-hidden shadow-lg" dir={dir} onOpenAutoFocus={e => e.preventDefault()}>
        <div className="p-6">
          <DialogHeader className="mb-6 text-right">
            <DialogTitle className="text-xl font-medium">{t('account.addTitle')}</DialogTitle>
            <p className="text-sm text-muted-foreground mt-1">{t('account.addDesc')}</p>
          </DialogHeader>
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('account.name')}</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder={t('account.namePlaceholder')} className="bg-secondary/50 border-border text-sm h-9" data-testid="input-name" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('account.firm')}</Label>
                <FirmCombobox value={firm} onChange={val => { setFirm(val); setTier(""); }} firms={firmsList} testId="input-firm" />
              </div>
            </div>
            {selectedFirmTiers.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('account.tier')}</Label>
                <Select value={tier} onValueChange={setTier}>
                  <SelectTrigger className="bg-secondary/50 border-border text-sm h-9" data-testid="select-tier"><SelectValue placeholder={t('account.tierPlaceholder')} /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {selectedFirmTiers.map(ft => <SelectItem key={ft.id} value={ft.name}>{ft.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('account.phase')}</Label>
                <Select value={stage} onValueChange={val => setStage(val as AccountStage)}>
                  <SelectTrigger className="bg-secondary/50 border-border text-sm h-9"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {STAGE_KEYS.map(key => (
                      <SelectItem key={key} value={key}>{t(`phases.${key}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('account.drawdownType')}</Label>
                <Select value={drawdownType} onValueChange={v => setDrawdownType(v as "static" | "trailing")}>
                  <SelectTrigger className="bg-secondary/50 border-border text-sm h-9"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="static">{t('account.drawdownStatic')}</SelectItem>
                    <SelectItem value="trailing">{t('account.drawdownTrailing')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('account.maxDrawdown')}</Label>
                <Input type="number" value={maxDrawdown} onChange={e => setMaxDrawdown(e.target.value)} placeholder="5000" className="bg-secondary/50 border-border text-sm h-9 font-mono text-left" dir="ltr" data-testid="input-maxdrawdown" />
              </div>
              {drawdownType === "trailing" && (
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('account.trailingDrawdown')}</Label>
                  <Input type="number" value={trailingDrawdown} onChange={e => setTrailingDrawdown(e.target.value)} placeholder="2000" className="bg-secondary/50 border-border text-sm h-9 font-mono text-left" dir="ltr" data-testid="input-trailing-drawdown" />
                </div>
              )}
            </div>
            <div className="p-3 bg-secondary/30 border border-border rounded-lg space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('account.size')}</Label>
                  <Input type="number" value={size} onChange={e => setSize(e.target.value)} placeholder="100000" className="bg-secondary/50 border-border text-sm h-9 font-mono text-left" dir="ltr" data-testid="input-size" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('account.balance')}</Label>
                  <Input type="number" value={balance} onChange={e => setBalance(e.target.value)} placeholder="105000" className="bg-secondary/50 border-border text-sm h-9 font-mono text-left" dir="ltr" data-testid="input-balance" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('account.profitTarget')}</Label>
                  <Input type="number" value={target} onChange={e => setTarget(e.target.value)} placeholder="10000" className="bg-secondary/50 border-border text-sm h-9 font-mono text-left" dir="ltr" data-testid="input-target" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('account.consistencyRule')}</Label>
                  <Input type="number" value={consistencyRule} onChange={e => setConsistencyRule(e.target.value)} placeholder="30" className="bg-secondary/50 border-border text-sm h-9 font-mono text-left" dir="ltr" />
                </div>
              </div>
            </div>
          </div>
        </div>
        {planLimitError && (
          <div className="mx-6 mb-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 space-y-2">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <span className="text-sm font-medium text-amber-600 dark:text-amber-400">{t('planLimit.title')}</span>
            </div>
            <p className="text-xs text-muted-foreground">{t(`planLimit.features.${planLimitError.feature}`)}</p>
            <div className="flex items-center gap-2">
              <Crown className="w-3.5 h-3.5 text-indigo-500" />
              <span className="text-xs font-medium">{t('planLimit.requiredPlan', { plan: planLimitError.requiredPlan.charAt(0).toUpperCase() + planLimitError.requiredPlan.slice(1) })}</span>
            </div>
            <Button size="sm" className="w-full bg-indigo-600 hover:bg-indigo-700 h-7 text-xs" onClick={() => { setIsOpen(false); resetForm(); navigate('/billing'); }} data-testid="button-account-limit-upgrade">
              <Crown className="w-3 h-3 me-1" /> {t('planLimit.upgrade')}
            </Button>
          </div>
        )}
        <div className="bg-muted/30 p-4 border-t border-border flex justify-end gap-2">
          <Button variant="ghost" onClick={() => { setIsOpen(false); resetForm(); }} className="h-8 text-sm">{t('account.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending} className="bg-foreground text-background hover:bg-foreground/90 h-8 text-sm px-6" data-testid="button-submit-account">
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t('account.submit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});


interface EditAccountDialogProps {
  account: DbAccount & { profit: number; computedStatus?: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const EditAccountDialog = memo(function EditAccountDialog({ account, open, onOpenChange }: EditAccountDialogProps) {
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? 'rtl' : 'ltr';
  const { data: firmsList = [] } = useQuery<(Firm & { tiers: FirmTier[] })[]>({ queryKey: ["/api/v1/firms"] });
  const isSynced = account.dataSource === "integration";

  const [name, setName] = useState(account.name);
  const [firm, setFirm] = useState(account.firm);
  const [tier, setTier] = useState((account as any).tier || "");
  const [stage, setStage] = useState<AccountStage>(account.stage as AccountStage);
  const [size, setSize] = useState(String(account.size));
  const [balance, setBalance] = useState(String(account.balance));
  const [target, setTarget] = useState(account.target != null ? String(account.target) : "");
  const [maxDrawdown, setMaxDrawdown] = useState(account.maxDrawdown != null ? String(account.maxDrawdown) : "");
  const [buffer, setBuffer] = useState(account.buffer != null ? String(account.buffer) : "");
  const [consistencyRule, setConsistencyRule] = useState(account.consistencyRule != null ? String(account.consistencyRule) : "");
  const [topDayProfit, setTopDayProfit] = useState(account.topDayProfit != null ? String(account.topDayProfit) : "");
  const [tradingDays, setTradingDays] = useState(account.tradingDays != null ? String(account.tradingDays) : "0");
  const [drawdownType, setDrawdownType] = useState<"static" | "trailing">((account.drawdownType as any) || "static");
  const [trailingDrawdown, setTrailingDrawdown] = useState(account.trailingDrawdown != null ? String(account.trailingDrawdown) : "");
  const [bufferEnabled, setBufferEnabled] = useState(account.bufferEnabled !== false);

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/v1/accounts/${id}`, data);
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/accounts"] });
      queryClient.invalidateQueries({ queryKey: [`/api/v1/accounts/${variables.id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/firms"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/trading-priorities"] });
    },
  });

  const firmTiers = useMemo(() => {
    const f = firmsList.find(f => f.name === firm);
    return f?.tiers || [];
  }, [firmsList, firm]);

  const handleSubmit = () => {
    const sizeNum = parseFloat(size);
    const balanceNum = parseFloat(balance);
    if (!name || !firm || isNaN(sizeNum) || isNaN(balanceNum)) return;
    const data: Record<string, any> = {
      name, firm, tier: tier || null, stage,
      target: target ? parseFloat(target) : null,
      buffer: buffer ? parseFloat(buffer) : null,
      drawdownType,
      bufferEnabled,
    };
    if (!isSynced) {
      data.size = sizeNum;
      data.balance = balanceNum;
      data.maxDrawdown = maxDrawdown ? parseFloat(maxDrawdown) : null;
      data.trailingDrawdown = trailingDrawdown ? parseFloat(trailingDrawdown) : null;
      data.consistencyRule = consistencyRule ? parseFloat(consistencyRule) : null;
      data.topDayProfit = topDayProfit ? parseFloat(topDayProfit) : null;
      data.tradingDays = tradingDays ? parseInt(tradingDays) : 0;
    }
    updateMutation.mutate({ id: account.id, data });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-card border-border shadow-lg p-0 gap-0" dir={dir} onOpenAutoFocus={e => e.preventDefault()}>
        <DialogHeader className="p-5 pb-4 border-b border-border">
          <DialogTitle className="text-lg font-semibold flex items-center gap-2"><Pencil className="w-4 h-4 text-indigo-500" /> {t('account.editTitle')}</DialogTitle>
        </DialogHeader>
        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {isSynced && (
            <div className="flex items-start gap-2.5 p-3 bg-cyan-500/10 border border-cyan-500/20 rounded-lg" data-testid="notice-synced-account">
              <RefreshCw className="w-4 h-4 text-cyan-500 mt-0.5 shrink-0" />
              <p className="text-xs text-cyan-600 dark:text-cyan-400 leading-relaxed">{t('account.syncedReadonly')}</p>
            </div>
          )}
          <div className="p-3 bg-secondary/30 border border-border rounded-lg space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('account.name')}</Label>
                <Input value={name} onChange={e => setName(e.target.value)} className="bg-secondary/50 border-border text-sm h-9" data-testid="input-edit-name" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('account.firm')}</Label>
                <FirmCombobox value={firm} onChange={val => { setFirm(val); setTier(""); }} firms={firmsList} testId="input-edit-firm" />
              </div>
            </div>
            {firmTiers.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('account.tier')}</Label>
                <Select value={tier} onValueChange={setTier}>
                  <SelectTrigger className="bg-secondary/50 border-border text-sm h-9" data-testid="select-edit-tier"><SelectValue placeholder={t('account.tierPlaceholder')} /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {firmTiers.map(ft => <SelectItem key={ft.id} value={ft.name}>{ft.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('account.phase')}</Label>
                <Select value={stage} onValueChange={v => setStage(v as AccountStage)}>
                  <SelectTrigger className="bg-secondary/50 border-border text-sm h-9" data-testid="select-edit-stage"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {STAGE_KEYS.map(key => <SelectItem key={key} value={key}>{t(`phases.${key}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('account.drawdownType')}</Label>
                <Select value={drawdownType} onValueChange={v => setDrawdownType(v as "static" | "trailing")}>
                  <SelectTrigger className="bg-secondary/50 border-border text-sm h-9"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="static">{t('account.drawdownStatic')}</SelectItem>
                    <SelectItem value="trailing">{t('account.drawdownTrailing')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className={`text-[10px] uppercase tracking-wider font-semibold ${isSynced ? 'text-cyan-500' : 'text-muted-foreground'}`}>
                  {t('account.maxDrawdown')} {isSynced && <Lock className="w-2.5 h-2.5 inline" />}
                </Label>
                <Input type="number" value={maxDrawdown} onChange={e => setMaxDrawdown(e.target.value)} readOnly={isSynced} className={`bg-secondary/50 border-border text-sm h-9 font-mono text-left ${isSynced ? 'opacity-60 cursor-not-allowed' : ''}`} dir="ltr" data-testid="input-edit-maxdrawdown" />
              </div>
              {drawdownType === "trailing" && (
                <div className="space-y-1.5">
                  <Label className={`text-[10px] uppercase tracking-wider font-semibold ${isSynced ? 'text-cyan-500' : 'text-muted-foreground'}`}>
                    {t('account.trailingDrawdown')} {isSynced && <Lock className="w-2.5 h-2.5 inline" />}
                  </Label>
                  <Input type="number" value={trailingDrawdown} onChange={e => setTrailingDrawdown(e.target.value)} readOnly={isSynced} placeholder="2000" className={`bg-secondary/50 border-border text-sm h-9 font-mono text-left ${isSynced ? 'opacity-60 cursor-not-allowed' : ''}`} dir="ltr" data-testid="input-edit-trailing-drawdown" />
                </div>
              )}
            </div>
          </div>
          <div className="p-3 bg-secondary/30 border border-border rounded-lg space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className={`text-[10px] uppercase tracking-wider font-semibold ${isSynced ? 'text-cyan-500' : 'text-muted-foreground'}`}>
                  {t('account.size')} {isSynced && <Lock className="w-2.5 h-2.5 inline" />}
                </Label>
                <Input type="number" value={size} onChange={e => setSize(e.target.value)} readOnly={isSynced} className={`bg-secondary/50 border-border text-sm h-9 font-mono text-left ${isSynced ? 'opacity-60 cursor-not-allowed' : ''}`} dir="ltr" data-testid="input-edit-size" />
              </div>
              <div className="space-y-1.5">
                <Label className={`text-[10px] uppercase tracking-wider font-semibold ${isSynced ? 'text-cyan-500' : 'text-muted-foreground'}`}>
                  {t('account.balanceShort')} {isSynced && <Lock className="w-2.5 h-2.5 inline" />}
                </Label>
                <Input type="number" value={balance} onChange={e => setBalance(e.target.value)} readOnly={isSynced} className={`bg-secondary/50 border-border text-sm h-9 font-mono text-left ${isSynced ? 'opacity-60 cursor-not-allowed' : ''}`} dir="ltr" data-testid="input-edit-balance" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('account.profitTarget')}</Label>
                <Input type="number" value={target} onChange={e => setTarget(e.target.value)} className="bg-secondary/50 border-border text-sm h-9 font-mono text-left" dir="ltr" data-testid="input-edit-target" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('account.buffer')}</Label>
                <Input type="number" value={buffer} onChange={e => setBuffer(e.target.value)} className="bg-secondary/50 border-border text-sm h-9 font-mono text-left" dir="ltr" data-testid="input-edit-buffer" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className={`text-[10px] uppercase tracking-wider font-semibold ${isSynced ? 'text-cyan-500' : 'text-muted-foreground'}`}>
                  {t('account.consistencyRule')} {isSynced && <Lock className="w-2.5 h-2.5 inline" />}
                </Label>
                <Input type="number" value={consistencyRule} onChange={e => setConsistencyRule(e.target.value)} readOnly={isSynced} className={`bg-secondary/50 border-border text-sm h-9 font-mono text-left ${isSynced ? 'opacity-60 cursor-not-allowed' : ''}`} dir="ltr" />
              </div>
              <div className="space-y-1.5">
                <Label className={`text-[10px] uppercase tracking-wider font-semibold ${isSynced ? 'text-cyan-500' : 'text-muted-foreground'}`}>
                  {t('account.topDayProfit')} {isSynced && <Lock className="w-2.5 h-2.5 inline" />}
                </Label>
                <Input type="number" value={topDayProfit} onChange={e => setTopDayProfit(e.target.value)} readOnly={isSynced} className={`bg-secondary/50 border-border text-sm h-9 font-mono text-left ${isSynced ? 'opacity-60 cursor-not-allowed' : ''}`} dir="ltr" />
              </div>
              <div className="space-y-1.5">
                <Label className={`text-[10px] uppercase tracking-wider font-semibold ${isSynced ? 'text-cyan-500' : 'text-muted-foreground'}`}>
                  {t('account.tradingDays')} {isSynced && <Lock className="w-2.5 h-2.5 inline" />}
                </Label>
                <Input type="number" value={tradingDays} onChange={e => setTradingDays(e.target.value)} readOnly={isSynced} className={`bg-secondary/50 border-border text-sm h-9 font-mono text-left ${isSynced ? 'opacity-60 cursor-not-allowed' : ''}`} dir="ltr" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer pt-1" data-testid="toggle-buffer-enabled">
              <input type="checkbox" checked={bufferEnabled} onChange={e => setBufferEnabled(e.target.checked)} className="rounded" />
              <span className="text-muted-foreground">{t('account.bufferBeforeTarget')}</span>
            </label>
          </div>
        </div>
        <div className="bg-muted/30 p-4 border-t border-border flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-8 text-sm">{t('account.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={updateMutation.isPending} className="bg-foreground text-background hover:bg-foreground/90 h-8 text-sm px-6" data-testid="button-save-edit">
            {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t('account.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});


interface AddWithdrawalDialogProps {
  accounts: (DbAccount & { profit: number })[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const AddWithdrawalDialog = memo(function AddWithdrawalDialog({ accounts, open, onOpenChange }: AddWithdrawalDialogProps) {
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? 'rtl' : 'ltr';

  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState("pending");
  const [notes, setNotes] = useState("");

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/v1/withdrawals", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/withdrawals"] });
    },
  });

  const resetForm = () => {
    setAccountId(""); setAmount(""); setDate(""); setStatus("pending"); setNotes("");
  };

  const handleSubmit = () => {
    const amountNum = parseFloat(amount);
    if (!accountId || isNaN(amountNum) || !date) return;
    const selectedAccount = accounts.find(a => String(a.id) === accountId);
    if (!selectedAccount) return;
    createMutation.mutate({
      accountId: selectedAccount.id, firm: selectedAccount.firm, accountName: selectedAccount.name,
      amount: amountNum, dateRequested: date, status, notes: notes || null,
    });
    onOpenChange(false);
    resetForm();
  };

  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (!o) resetForm(); }}>
      <DialogContent className="max-w-md bg-card border-border shadow-lg p-0 gap-0" dir={dir} onOpenAutoFocus={e => e.preventDefault()}>
        <DialogHeader className="p-5 pb-4 border-b border-border">
          <DialogTitle className="text-lg font-semibold flex items-center gap-2"><CreditCard className="w-4 h-4 text-purple-500" /> {t('withdrawal.title')}</DialogTitle>
        </DialogHeader>
        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('withdrawal.account')}</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="bg-secondary/50 border-border text-sm h-9" data-testid="select-withdrawal-account"><SelectValue placeholder={t('withdrawal.accountPlaceholder')} /></SelectTrigger>
              <SelectContent className="bg-card border-border">
                {accounts.filter(a => a.stage === 'funded' || a.stage === 'payout').map(a => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.name} ({a.firm})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('withdrawal.amount')}</Label>
              <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="bg-secondary/50 border-border text-sm h-9 font-mono text-left" dir="ltr" data-testid="input-withdrawal-amount" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('withdrawal.date')}</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="bg-secondary/50 border-border text-sm h-9 font-mono" dir="ltr" data-testid="input-withdrawal-date" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('withdrawal.status')}</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="bg-secondary/50 border-border text-sm h-9"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="pending">{t('withdrawal.statusPending')}</SelectItem>
                <SelectItem value="approved">{t('withdrawal.statusApproved')}</SelectItem>
                <SelectItem value="paid">{t('withdrawal.statusPaid')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('withdrawal.notes')}</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} className="bg-secondary/50 border-border text-sm h-9" />
          </div>
        </div>
        <div className="bg-muted/30 p-4 border-t border-border flex justify-end gap-2">
          <Button variant="ghost" onClick={() => { onOpenChange(false); resetForm(); }} className="h-8 text-sm">{t('withdrawal.cancel')}</Button>
          <Button onClick={handleSubmit} className="bg-foreground text-background hover:bg-foreground/90 h-8 text-sm px-6" data-testid="button-submit-withdrawal">{t('withdrawal.submit')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});
