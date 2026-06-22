import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import {
  Plus, Pencil, Trash2, BookOpen, TrendingUp, TrendingDown,
  Target, BarChart3, Tag, Palette, ChevronDown, ChevronUp,
  CheckCircle, XCircle, Loader2
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { motion, AnimatePresence } from "framer-motion";

interface Playbook {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  rules: string | null;
  color: string | null;
  icon: string | null;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

interface PlaybookStats {
  totalTrades: number;
  winners: number;
  losers: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  bestTrade: number;
  worstTrade: number;
}

interface TradeTag {
  id: number;
  userId: number;
  name: string;
  color: string | null;
  category: string | null;
  createdAt: string | null;
}

const PLAYBOOK_COLORS = [
  "#6366f1", "#3b82f6", "#8b5cf6", "#ec4899", "#f97316",
  "#f59e0b", "#10b981", "#14b8a6", "#06b6d4", "#ef4444",
];

const TAG_COLORS = [
  "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316",
];

export default function PlaybookManager() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showPlaybookDialog, setShowPlaybookDialog] = useState(false);
  const [showTagDialog, setShowTagDialog] = useState(false);
  const [editingPlaybook, setEditingPlaybook] = useState<Playbook | null>(null);
  const [editingTag, setEditingTag] = useState<TradeTag | null>(null);
  const [expandedPlaybook, setExpandedPlaybook] = useState<number | null>(null);
  const [pbForm, setPbForm] = useState({ name: "", description: "", rules: "", color: "#6366f1" });
  const [tagForm, setTagForm] = useState({ name: "", color: "#3b82f6", category: "custom" });

  const { data: playbooksData = [], isLoading: loadingPlaybooks } = useQuery<Playbook[]>({
    queryKey: ["/api/v1/playbooks"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: tagsData = [], isLoading: loadingTags } = useQuery<TradeTag[]>({
    queryKey: ["/api/v1/trade-tags"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const createPlaybookMut = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/v1/playbooks", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/playbooks"] });
      setShowPlaybookDialog(false);
      toast({ title: t("playbook.created") });
    },
  });

  const updatePlaybookMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/v1/playbooks/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/playbooks"] });
      setShowPlaybookDialog(false);
      setEditingPlaybook(null);
      toast({ title: t("playbook.updated") });
    },
  });

  const deletePlaybookMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/v1/playbooks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/playbooks"] });
      toast({ title: t("playbook.deleted") });
    },
  });

  const createTagMut = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/v1/trade-tags", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/trade-tags"] });
      setShowTagDialog(false);
      toast({ title: t("playbook.tagCreated") });
    },
  });

  const updateTagMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/v1/trade-tags/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/trade-tags"] });
      setShowTagDialog(false);
      setEditingTag(null);
      toast({ title: t("playbook.tagUpdated") });
    },
  });

  const deleteTagMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/v1/trade-tags/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/trade-tags"] });
      toast({ title: t("playbook.tagDeleted") });
    },
  });

  function openNewPlaybook() {
    setEditingPlaybook(null);
    setPbForm({ name: "", description: "", rules: "", color: "#6366f1" });
    setShowPlaybookDialog(true);
  }

  function openEditPlaybook(pb: Playbook) {
    setEditingPlaybook(pb);
    setPbForm({
      name: pb.name,
      description: pb.description || "",
      rules: pb.rules || "",
      color: pb.color || "#6366f1",
    });
    setShowPlaybookDialog(true);
  }

  function savePlaybook() {
    if (!pbForm.name.trim()) return;
    if (editingPlaybook) {
      updatePlaybookMut.mutate({ id: editingPlaybook.id, data: pbForm });
    } else {
      createPlaybookMut.mutate(pbForm);
    }
  }

  function openNewTag() {
    setEditingTag(null);
    setTagForm({ name: "", color: "#3b82f6", category: "custom" });
    setShowTagDialog(true);
  }

  function openEditTag(tag: TradeTag) {
    setEditingTag(tag);
    setTagForm({ name: tag.name, color: tag.color || "#3b82f6", category: tag.category || "custom" });
    setShowTagDialog(true);
  }

  function saveTag() {
    if (!tagForm.name.trim()) return;
    if (editingTag) {
      updateTagMut.mutate({ id: editingTag.id, data: tagForm });
    } else {
      createTagMut.mutate(tagForm);
    }
  }

  if (loadingPlaybooks || loadingTags) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <BookOpen className="w-5 h-5" />
              {t("playbook.strategies")}
            </CardTitle>
            <Button size="sm" onClick={openNewPlaybook} data-testid="btn-add-playbook">
              <Plus className="w-4 h-4 me-1" />
              {t("playbook.addPlaybook")}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {playbooksData.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p>{t("playbook.noPlaybooks")}</p>
                <p className="text-sm mt-1">{t("playbook.noPlaybooksHint")}</p>
              </div>
            ) : (
              <AnimatePresence>
                {playbooksData.map((pb) => (
                  <PlaybookCard
                    key={pb.id}
                    playbook={pb}
                    isExpanded={expandedPlaybook === pb.id}
                    onToggle={() => setExpandedPlaybook(expandedPlaybook === pb.id ? null : pb.id)}
                    onEdit={() => openEditPlaybook(pb)}
                    onDelete={() => deletePlaybookMut.mutate(pb.id)}
                    t={t}
                  />
                ))}
              </AnimatePresence>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Tag className="w-5 h-5" />
              {t("playbook.customTags")}
            </CardTitle>
            <Button size="sm" onClick={openNewTag} data-testid="btn-add-tag">
              <Plus className="w-4 h-4 me-1" />
              {t("playbook.addTag")}
            </Button>
          </CardHeader>
          <CardContent>
            {tagsData.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Tag className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p>{t("playbook.noTags")}</p>
                <p className="text-sm mt-1">{t("playbook.noTagsHint")}</p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tagsData.map((tag) => (
                  <div
                    key={tag.id}
                    className="group flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm border cursor-pointer hover:shadow-sm transition-shadow"
                    style={{ borderColor: tag.color || "#3b82f6" }}
                    data-testid={`tag-item-${tag.id}`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: tag.color || "#3b82f6" }}
                    />
                    <span>{tag.name}</span>
                    <button
                      className="opacity-0 group-hover:opacity-100 transition-opacity ms-1"
                      onClick={() => openEditTag(tag)}
                      data-testid={`btn-edit-tag-${tag.id}`}
                    >
                      <Pencil className="w-3 h-3 text-muted-foreground" />
                    </button>
                    <button
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => deleteTagMut.mutate(tag.id)}
                      data-testid={`btn-delete-tag-${tag.id}`}
                    >
                      <Trash2 className="w-3 h-3 text-red-400" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showPlaybookDialog} onOpenChange={setShowPlaybookDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingPlaybook ? t("playbook.editPlaybook") : t("playbook.addPlaybook")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("playbook.name")}</Label>
              <Input
                value={pbForm.name}
                onChange={(e) => setPbForm({ ...pbForm, name: e.target.value })}
                placeholder={t("playbook.namePlaceholder")}
                data-testid="input-playbook-name"
              />
            </div>
            <div>
              <Label>{t("playbook.description")}</Label>
              <Textarea
                value={pbForm.description}
                onChange={(e) => setPbForm({ ...pbForm, description: e.target.value })}
                placeholder={t("playbook.descriptionPlaceholder")}
                rows={2}
                data-testid="input-playbook-description"
              />
            </div>
            <div>
              <Label>{t("playbook.rules")}</Label>
              <Textarea
                value={pbForm.rules}
                onChange={(e) => setPbForm({ ...pbForm, rules: e.target.value })}
                placeholder={t("playbook.rulesPlaceholder")}
                rows={3}
                data-testid="input-playbook-rules"
              />
            </div>
            <div>
              <Label>{t("playbook.color")}</Label>
              <div className="flex gap-2 mt-1">
                {PLAYBOOK_COLORS.map((c) => (
                  <button
                    key={c}
                    className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      borderColor: pbForm.color === c ? "white" : "transparent",
                      boxShadow: pbForm.color === c ? `0 0 0 2px ${c}` : "none",
                    }}
                    onClick={() => setPbForm({ ...pbForm, color: c })}
                    data-testid={`color-playbook-${c}`}
                  />
                ))}
              </div>
            </div>
            <Button
              className="w-full"
              onClick={savePlaybook}
              disabled={!pbForm.name.trim() || createPlaybookMut.isPending || updatePlaybookMut.isPending}
              data-testid="btn-save-playbook"
            >
              {(createPlaybookMut.isPending || updatePlaybookMut.isPending) && (
                <Loader2 className="w-4 h-4 me-2 animate-spin" />
              )}
              {editingPlaybook ? t("common.save") : t("common.create")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showTagDialog} onOpenChange={setShowTagDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingTag ? t("playbook.editTag") : t("playbook.addTag")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("playbook.tagName")}</Label>
              <Input
                value={tagForm.name}
                onChange={(e) => setTagForm({ ...tagForm, name: e.target.value })}
                placeholder={t("playbook.tagNamePlaceholder")}
                data-testid="input-tag-name"
              />
            </div>
            <div>
              <Label>{t("playbook.color")}</Label>
              <div className="flex gap-2 mt-1">
                {TAG_COLORS.map((c) => (
                  <button
                    key={c}
                    className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      borderColor: tagForm.color === c ? "white" : "transparent",
                      boxShadow: tagForm.color === c ? `0 0 0 2px ${c}` : "none",
                    }}
                    onClick={() => setTagForm({ ...tagForm, color: c })}
                    data-testid={`color-tag-${c}`}
                  />
                ))}
              </div>
            </div>
            <Button
              className="w-full"
              onClick={saveTag}
              disabled={!tagForm.name.trim() || createTagMut.isPending || updateTagMut.isPending}
              data-testid="btn-save-tag"
            >
              {(createTagMut.isPending || updateTagMut.isPending) && (
                <Loader2 className="w-4 h-4 me-2 animate-spin" />
              )}
              {editingTag ? t("common.save") : t("common.create")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlaybookCard({
  playbook,
  isExpanded,
  onToggle,
  onEdit,
  onDelete,
  t,
}: {
  playbook: Playbook;
  isExpanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  t: any;
}) {
  const { data: stats } = useQuery<PlaybookStats>({
    queryKey: [`/api/v1/playbooks/${playbook.id}/stats`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: isExpanded,
  });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="border rounded-lg overflow-hidden"
      data-testid={`playbook-card-${playbook.id}`}
    >
      <div
        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={onToggle}
      >
        <div
          className="w-3 h-3 rounded-full shrink-0"
          style={{ backgroundColor: playbook.color || "#6366f1" }}
        />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{playbook.name}</div>
          {playbook.description && (
            <div className="text-xs text-muted-foreground truncate">{playbook.description}</div>
          )}
        </div>
        <Badge variant={playbook.isActive ? "default" : "secondary"} className="text-[10px]">
          {playbook.isActive ? t("playbook.active") : t("playbook.inactive")}
        </Badge>
        <div className="flex items-center gap-1">
          <button onClick={(e) => { e.stopPropagation(); onEdit(); }} data-testid={`btn-edit-playbook-${playbook.id}`}>
            <Pencil className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} data-testid={`btn-delete-playbook-${playbook.id}`}>
            <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-red-500" />
          </button>
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 border-t pt-3 space-y-3">
              {playbook.rules && (
                <div className="text-sm">
                  <div className="font-medium mb-1 text-muted-foreground">{t("playbook.rules")}:</div>
                  <div className="whitespace-pre-wrap text-sm bg-muted/30 rounded p-2">{playbook.rules}</div>
                </div>
              )}

              {stats ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <StatBox
                    label={t("playbook.totalTrades")}
                    value={stats.totalTrades.toString()}
                    icon={<BarChart3 className="w-4 h-4" />}
                  />
                  <StatBox
                    label={t("playbook.winRate")}
                    value={`${stats.winRate.toFixed(1)}%`}
                    icon={<Target className="w-4 h-4" />}
                    color={stats.winRate >= 50 ? "text-green-500" : "text-red-400"}
                  />
                  <StatBox
                    label={t("playbook.totalPnl")}
                    value={`$${stats.totalPnl.toFixed(0)}`}
                    icon={stats.totalPnl >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                    color={stats.totalPnl >= 0 ? "text-green-500" : "text-red-400"}
                  />
                  <StatBox
                    label={t("playbook.avgPnl")}
                    value={`$${stats.avgPnl.toFixed(0)}`}
                    icon={stats.avgPnl >= 0 ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    color={stats.avgPnl >= 0 ? "text-green-500" : "text-red-400"}
                  />
                </div>
              ) : (
                <div className="flex justify-center py-2">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function StatBox({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color?: string }) {
  return (
    <div className="bg-muted/30 rounded p-2 text-center">
      <div className="flex items-center justify-center gap-1 text-muted-foreground mb-0.5">
        {icon}
        <span className="text-[10px]">{label}</span>
      </div>
      <div className={`text-sm font-bold ${color || ""}`}>{value}</div>
    </div>
  );
}
