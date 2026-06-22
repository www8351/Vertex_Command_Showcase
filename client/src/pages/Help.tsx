import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { getCsrfToken } from "@/lib/queryClient";
import { isRTL } from "@/i18n";
import {
  MessageCircle, ChevronDown, ChevronUp, Send, Loader2,
  HelpCircle, ArrowRight, Settings, Building,
  CreditCard, ShieldAlert, Bot, Crown,
  BookOpen, Activity, Search, CheckCircle2, AlertTriangle,
  XCircle, Clock, Zap, BarChart3, Copy, FileText,
  Shield, Link, Wallet, RefreshCw, ChevronRight,
  Server, Database, Cpu, Wifi, TrendingUp, Users,
  Target, AlertCircle, Lightbulb, Wrench
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/apiBase";

type TabType = "kb" | "faq" | "status" | "chat";

const CATEGORY_ICONS: Record<string, any> = {
  all: HelpCircle,
  systemUsage: Settings,
  drawdownRules: ShieldAlert,
  propFirms: Building,
  withdrawals: CreditCard,
};

const CATEGORY_KEYS = ["all", "systemUsage", "drawdownRules", "propFirms", "withdrawals"];

const FAQ_CATEGORY_MAP: Record<number, string> = {
  0: "systemUsage", 1: "systemUsage", 2: "systemUsage", 3: "systemUsage",
  4: "drawdownRules", 5: "drawdownRules", 6: "drawdownRules",
  7: "propFirms", 8: "propFirms", 9: "propFirms",
  10: "withdrawals", 11: "withdrawals",
};

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  isPlanLimit?: boolean;
}

interface SystemService {
  name: string;
  status: "operational" | "degraded" | "down";
  latency?: number;
  detail?: string;
}

interface SystemStatus {
  overall: "operational" | "degraded" | "down";
  services: SystemService[];
  uptime: number;
  timestamp: string;
}

const KB_CATEGORIES = [
  { key: "gettingStarted", icon: Zap, color: "text-green-500 bg-green-500/10" },
  { key: "dashboard", icon: BarChart3, color: "text-blue-500 bg-blue-500/10" },
  { key: "integrations", icon: Link, color: "text-purple-500 bg-purple-500/10" },
  { key: "copyTrading", icon: Copy, color: "text-orange-500 bg-orange-500/10" },
  { key: "journal", icon: FileText, color: "text-cyan-500 bg-cyan-500/10" },
  { key: "billing", icon: Wallet, color: "text-emerald-500 bg-emerald-500/10" },
  { key: "riskManagement", icon: Shield, color: "text-red-500 bg-red-500/10" },
  { key: "troubleshooting", icon: Wrench, color: "text-amber-500 bg-amber-500/10" },
];

const SERVICE_ICONS: Record<string, any> = {
  database: Database,
  api_server: Server,
  ai_assistant: Cpu,
  copy_engine: Copy,
  broker_connections: Wifi,
  dependency_health: Shield,
};

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function StatusBadge({ status }: { status: string }) {
  const config = status === "operational"
    ? { icon: CheckCircle2, color: "text-green-500 bg-green-500/10 border-green-500/20", label: "Operational" }
    : status === "degraded"
    ? { icon: AlertTriangle, color: "text-amber-500 bg-amber-500/10 border-amber-500/20", label: "Degraded" }
    : { icon: XCircle, color: "text-red-500 bg-red-500/10 border-red-500/20", label: "Down" };
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${config.color}`} data-testid={`status-badge-${status}`}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}

export default function Help() {
  const [, navigate] = useLocation();
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? 'rtl' : 'ltr';
  const [activeTab, setActiveTab] = useState<TabType>("kb");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [kbSearch, setKbSearch] = useState("");
  const [expandedKbCategory, setExpandedKbCategory] = useState<string | null>(null);
  const [expandedKbArticle, setExpandedKbArticle] = useState<string | null>(null);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: systemStatus, isLoading: statusLoading, refetch: refetchStatus } = useQuery<SystemStatus>({
    queryKey: ["/api/v1/system/status"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/v1/system/status"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 30000,
    enabled: activeTab === "status",
  });

  const faqItems = Array.from({ length: 12 }, (_, i) => ({
    question: t(`help.faq.q${i + 1}`, { defaultValue: '' }),
    answer: t(`help.faq.a${i + 1}`, { defaultValue: '' }),
    category: FAQ_CATEGORY_MAP[i] || "systemUsage",
  })).filter(f => f.question);

  const filteredFaq = selectedCategory === "all"
    ? faqItems
    : faqItems.filter(f => f.category === selectedCategory);

  const kbCategories = KB_CATEGORIES.map(cat => {
    const articles = Array.from({ length: 6 }, (_, i) => {
      const title = t(`help.kb.${cat.key}.a${i + 1}.title`, { defaultValue: '' });
      const content = t(`help.kb.${cat.key}.a${i + 1}.content`, { defaultValue: '' });
      return title ? { id: `${cat.key}-${i}`, title, content } : null;
    }).filter(Boolean) as { id: string; title: string; content: string }[];
    return { ...cat, articles, label: t(`help.kb.${cat.key}.title`, { defaultValue: cat.key }) };
  });

  const filteredKb = kbSearch.trim()
    ? kbCategories.map(cat => ({
        ...cat,
        articles: cat.articles.filter(a =>
          a.title.toLowerCase().includes(kbSearch.toLowerCase()) ||
          a.content.toLowerCase().includes(kbSearch.toLowerCase())
        ),
      })).filter(cat => cat.articles.length > 0)
    : kbCategories;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const sendMessage = useCallback(async () => {
    if (!inputMessage.trim() || isLoading) return;

    const userMessage = inputMessage.trim();
    setInputMessage("");
    setChatMessages(prev => [...prev, { role: "user", content: userMessage }]);
    setIsLoading(true);

    try {
      const csrfToken = await getCsrfToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (csrfToken) headers["x-csrf-token"] = csrfToken;
      const response = await fetch(apiUrl("/api/v1/help/chat"), {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          message: userMessage,
          history: chatMessages.slice(-10),
        }),
      });

      if (!response.ok) {
        if (response.status === 403) {
          try {
            const err = await response.json();
            if (err.code === 'plan_limit') {
              setChatMessages(prev => [...prev, { role: "assistant", content: t('planLimit.features.ai_chatbot'), isPlanLimit: true }]);
              setIsLoading(false);
              return;
            }
          } catch {}
        }
        throw new Error("Failed");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let buffer = "";
      let assistantContent = "";

      setChatMessages(prev => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.content) {
              assistantContent += event.content;
              setChatMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: assistantContent };
                return updated;
              });
            }
          } catch {}
        }
      }
    } catch {
      setChatMessages(prev => [...prev, { role: "assistant", content: t('help.chatError') }]);
    } finally {
      setIsLoading(false);
    }
  }, [inputMessage, isLoading, chatMessages, t]);

  const tabs: { key: TabType; icon: any; labelKey: string }[] = [
    { key: "kb", icon: BookOpen, labelKey: "help.kbTab" },
    { key: "faq", icon: HelpCircle, labelKey: "help.faqTab" },
    { key: "status", icon: Activity, labelKey: "help.statusTab" },
    { key: "chat", icon: Bot, labelKey: "help.chatTab" },
  ];

  return (
    <div className="h-full bg-background text-foreground font-sans" dir={dir}>
      <div className="flex flex-col h-full">
        <header className="h-auto sm:h-14 flex flex-wrap items-center justify-between rtl:flex-row-reverse px-3 sm:px-4 lg:px-6 py-2 sm:py-0 gap-2 border-b border-border bg-card">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-indigo-600 flex items-center justify-center flex-shrink-0">
                <HelpCircle className="w-4 h-4 text-white" />
              </div>
              <h1 className="text-sm sm:text-base font-semibold">{t('help.helpCenter')}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
          </div>
          <div className="flex gap-1 bg-secondary/50 rounded-lg p-0.5 overflow-x-auto">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap flex items-center gap-1.5 ${activeTab === tab.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  data-testid={`tab-${tab.key}`}>
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{t(tab.labelKey)}</span>
                </button>
              );
            })}
          </div>
        </header>

        <div className="flex-1 overflow-hidden">
          {activeTab === "kb" && (
            <div className="h-full overflow-auto p-4 lg:p-6">
              <div className="max-w-4xl mx-auto space-y-6">
                <div>
                  <h2 className="text-xl font-bold mb-2">{t('help.kbTitle')}</h2>
                  <p className="text-sm text-muted-foreground mb-4">{t('help.kbSubtitle')}</p>
                  <div className="relative">
                    <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={kbSearch}
                      onChange={e => setKbSearch(e.target.value)}
                      placeholder={t('help.kbSearchPlaceholder')}
                      className="w-full bg-secondary/50 border border-border rounded-lg ps-10 pe-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all placeholder:text-muted-foreground"
                      data-testid="input-kb-search"
                    />
                  </div>
                </div>

                {kbSearch.trim() && filteredKb.length === 0 && (
                  <div className="text-center py-12">
                    <Search className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
                    <p className="text-sm text-muted-foreground">{t('help.kbNoResults')}</p>
                    <Button
                      onClick={() => { setActiveTab("chat"); setKbSearch(""); }}
                      className="mt-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-8 px-4"
                      data-testid="button-kb-ask-bot">
                      <Bot className="w-3.5 h-3.5 me-1.5" /> {t('help.askBot')}
                    </Button>
                  </div>
                )}

                <div className={kbSearch.trim() ? "space-y-4" : "grid grid-cols-1 sm:grid-cols-2 gap-3"}>
                  {filteredKb.map(cat => {
                    const Icon = cat.icon;
                    const isExpanded = expandedKbCategory === cat.key || !!kbSearch.trim();
                    return (
                      <div key={cat.key} className={kbSearch.trim() ? "" : ""}>
                        <button
                          onClick={() => setExpandedKbCategory(isExpanded && !kbSearch.trim() ? null : cat.key)}
                          className={`w-full bg-card border border-border rounded-lg p-4 text-start hover:border-indigo-500/30 transition-all ${isExpanded ? "border-indigo-500/30" : ""}`}
                          data-testid={`kb-cat-${cat.key}`}>
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${cat.color}`}>
                              <Icon className="w-4.5 h-4.5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="text-sm font-semibold">{cat.label}</h3>
                              <p className="text-xs text-muted-foreground">{cat.articles.length} {t('help.kbArticles')}</p>
                            </div>
                            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                          </div>
                        </button>
                        {isExpanded && (
                          <div className="mt-2 space-y-1.5 ps-2">
                            {cat.articles.map(article => (
                              <div key={article.id} className="bg-card/50 border border-border rounded-lg overflow-hidden" data-testid={`kb-article-${article.id}`}>
                                <button
                                  onClick={() => setExpandedKbArticle(expandedKbArticle === article.id ? null : article.id)}
                                  className="w-full flex items-center gap-2 p-3 text-start hover:bg-secondary/30 transition-colors">
                                  <FileText className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                  <span className="text-sm flex-1">{article.title}</span>
                                  <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${expandedKbArticle === article.id ? "rotate-90" : ""}`} />
                                </button>
                                {expandedKbArticle === article.id && (
                                  <div className="px-3 pb-3 ps-9">
                                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{article.content}</p>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="bg-gradient-to-r from-indigo-600/10 to-purple-600/10 border border-indigo-500/20 rounded-lg p-5 text-center">
                  <Lightbulb className="w-8 h-8 text-indigo-500 mx-auto mb-2" />
                  <h3 className="text-sm font-semibold mb-1">{t('help.kbStillNeedHelp')}</h3>
                  <p className="text-xs text-muted-foreground mb-3">{t('help.kbStillNeedHelpDesc')}</p>
                  <div className="flex gap-2 justify-center">
                    <Button
                      onClick={() => setActiveTab("chat")}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-8 px-4"
                      data-testid="button-kb-chat">
                      <MessageCircle className="w-3.5 h-3.5 me-1.5" /> {t('help.askBot')}
                    </Button>
                    <Button
                      onClick={() => setActiveTab("status")}
                      variant="outline"
                      className="text-xs h-8 px-4"
                      data-testid="button-kb-status">
                      <Activity className="w-3.5 h-3.5 me-1.5" /> {t('help.statusTab')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "faq" && (
            <div className="h-full overflow-auto p-4 lg:p-6">
              <div className="max-w-3xl mx-auto space-y-6">
                <div>
                  <h2 className="text-xl font-bold mb-2">{t('help.faqTitle')}</h2>
                  <p className="text-sm text-muted-foreground">{t('help.faqSubtitle')}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {CATEGORY_KEYS.map(catKey => {
                    const Icon = CATEGORY_ICONS[catKey] || HelpCircle;
                    return (
                      <button
                        key={catKey}
                        onClick={() => setSelectedCategory(catKey)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${selectedCategory === catKey ? "bg-indigo-600 text-white border-indigo-600" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50"}`}
                        data-testid={`filter-${catKey}`}>
                        <Icon className="w-3.5 h-3.5" />
                        {t(`help.categories.${catKey}`)}
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-2">
                  {filteredFaq.map((faq, index) => (
                    <div
                      key={index}
                      className="bg-card border border-border rounded-lg overflow-hidden"
                      data-testid={`faq-item-${index}`}>
                      <button
                        onClick={() => setExpandedFaq(expandedFaq === index ? null : index)}
                        className="w-full flex items-center justify-between p-4 text-start hover:bg-secondary/20 transition-colors">
                        <div className="flex items-center gap-3 flex-1">
                          <HelpCircle className="w-4 h-4 text-indigo-500 shrink-0" />
                          <span className="text-sm font-medium">{faq.question}</span>
                        </div>
                        {expandedFaq === index
                          ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                          : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                      </button>
                      {expandedFaq === index && (
                        <div className="px-4 pb-4 ps-11">
                          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{faq.answer}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="bg-gradient-to-r from-indigo-600/10 to-purple-600/10 border border-indigo-500/20 rounded-lg p-5 text-center">
                  <Bot className="w-8 h-8 text-indigo-500 mx-auto mb-2" />
                  <h3 className="text-sm font-semibold mb-1">{t('help.notFoundAnswer')}</h3>
                  <p className="text-xs text-muted-foreground mb-3">{t('help.askBotDesc')}</p>
                  <Button
                    onClick={() => setActiveTab("chat")}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-8 px-4"
                    data-testid="button-go-to-chat">
                    <MessageCircle className="w-3.5 h-3.5 me-1.5" /> {t('help.askBot')}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "status" && (
            <div className="h-full overflow-auto p-4 lg:p-6">
              <div className="max-w-3xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold mb-1">{t('help.statusTitle')}</h2>
                    <p className="text-sm text-muted-foreground">{t('help.statusSubtitle')}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetchStatus()}
                    className="h-8 text-xs"
                    data-testid="button-refresh-status">
                    <RefreshCw className={`w-3.5 h-3.5 me-1.5 ${statusLoading ? "animate-spin" : ""}`} />
                    {t('help.statusRefresh')}
                  </Button>
                </div>

                {statusLoading && !systemStatus ? (
                  <div className="text-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">{t('help.statusLoading')}</p>
                  </div>
                ) : !systemStatus ? (
                  <div className="text-center py-12">
                    <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground mb-3">{t('help.statusFetchError')}</p>
                    <Button variant="outline" size="sm" onClick={() => refetchStatus()} data-testid="button-retry-status">
                      <RefreshCw className="w-3.5 h-3.5 me-1.5" /> {t('help.statusRefresh')}
                    </Button>
                  </div>
                ) : systemStatus ? (
                  <>
                    <div className={`rounded-xl p-5 border ${
                      systemStatus.overall === "operational"
                        ? "bg-green-500/5 border-green-500/20"
                        : systemStatus.overall === "degraded"
                        ? "bg-amber-500/5 border-amber-500/20"
                        : "bg-red-500/5 border-red-500/20"
                    }`} data-testid="status-overall">
                      <div className="flex items-center gap-3">
                        {systemStatus.overall === "operational"
                          ? <CheckCircle2 className="w-8 h-8 text-green-500" />
                          : systemStatus.overall === "degraded"
                          ? <AlertTriangle className="w-8 h-8 text-amber-500" />
                          : <XCircle className="w-8 h-8 text-red-500" />}
                        <div>
                          <h3 className="text-lg font-bold">
                            {systemStatus.overall === "operational"
                              ? t('help.statusAllOperational')
                              : systemStatus.overall === "degraded"
                              ? t('help.statusDegraded')
                              : t('help.statusDown')}
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            {t('help.statusLastUpdated')}: {new Date(systemStatus.timestamp).toLocaleTimeString()}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div className="bg-card border border-border rounded-lg p-4 text-center" data-testid="status-uptime">
                        <Clock className="w-5 h-5 text-indigo-500 mx-auto mb-1.5" />
                        <p className="text-lg font-bold">{formatUptime(systemStatus.uptime)}</p>
                        <p className="text-xs text-muted-foreground">{t('help.statusUptime')}</p>
                      </div>
                      <div className="bg-card border border-border rounded-lg p-4 text-center" data-testid="status-services-count">
                        <Server className="w-5 h-5 text-indigo-500 mx-auto mb-1.5" />
                        <p className="text-lg font-bold">{systemStatus.services.length}</p>
                        <p className="text-xs text-muted-foreground">{t('help.statusServices')}</p>
                      </div>
                      <div className="bg-card border border-border rounded-lg p-4 text-center col-span-2 sm:col-span-1" data-testid="status-response-time">
                        <Zap className="w-5 h-5 text-indigo-500 mx-auto mb-1.5" />
                        <p className="text-lg font-bold">
                          {systemStatus.services.find(s => s.name === "database")?.latency ?? "—"}ms
                        </p>
                        <p className="text-xs text-muted-foreground">{t('help.statusDbLatency')}</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold">{t('help.statusServiceDetails')}</h3>
                      {systemStatus.services.map(service => {
                        const Icon = SERVICE_ICONS[service.name] || Server;
                        return (
                          <div key={service.name} className="bg-card border border-border rounded-lg p-4 flex items-center gap-3" data-testid={`status-service-${service.name}`}>
                            <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                              <Icon className="w-4 h-4 text-muted-foreground" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{t(`help.statusService.${service.name}`)}</p>
                              {service.detail && <p className="text-xs text-muted-foreground">{service.detail}</p>}
                              {service.latency !== undefined && (
                                <p className="text-xs text-muted-foreground">{t('help.statusLatency')}: {service.latency}ms</p>
                              )}
                            </div>
                            <StatusBadge status={service.status} />
                          </div>
                        );
                      })}
                    </div>

                    <div className="bg-card border border-border rounded-lg p-5">
                      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-indigo-500" />
                        {t('help.troubleshootTitle')}
                      </h3>
                      <div className="space-y-2">
                        {["clearCache", "reconnectBroker", "resetCopyEngine"].map(action => (
                          <div key={action} className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors" data-testid={`troubleshoot-${action}`}>
                            <Wrench className="w-4 h-4 text-amber-500 shrink-0" />
                            <div className="flex-1">
                              <p className="text-sm font-medium">{t(`help.troubleshoot.${action}.title`)}</p>
                              <p className="text-xs text-muted-foreground">{t(`help.troubleshoot.${action}.desc`)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          )}

          {activeTab === "chat" && (
            <div className="h-full flex flex-col">
              <div className="flex-1 overflow-auto p-4 lg:p-6">
                <div className="max-w-2xl mx-auto space-y-4">
                  {chatMessages.length === 0 && (
                    <div className="text-center py-12">
                      <Bot className="w-12 h-12 text-indigo-500 mx-auto mb-3" />
                      <h3 className="text-lg font-semibold mb-1">{t('help.botGreeting')}</h3>
                      <p className="text-sm text-muted-foreground mb-6">{t('help.botHint')}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg mx-auto">
                        {[
                          t('help.faq.q5'),
                          t('help.faq.q7'),
                          t('help.faq.q3'),
                          t('help.faq.q10'),
                        ].map((q, i) => (
                          <button
                            key={i}
                            onClick={() => { setInputMessage(q); setTimeout(() => inputRef.current?.focus(), 100); }}
                            className="text-start text-xs p-3 bg-card border border-border rounded-lg hover:bg-secondary/50 hover:border-indigo-500/30 transition-colors text-muted-foreground hover:text-foreground"
                            data-testid={`suggestion-${i}`}>
                            <ArrowRight className="w-3 h-3 inline-block me-1.5 text-indigo-500" />
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {chatMessages.map((msg, index) => (
                    <div
                      key={index}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                      data-testid={`chat-message-${index}`}>
                      <div className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-line ${
                        msg.role === "user"
                          ? "bg-indigo-600 text-white rounded-br-sm"
                          : "bg-card border border-border text-foreground rounded-bl-sm"
                      }`}>
                        {msg.role === "assistant" && !msg.content && (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span className="text-xs">{t('help.thinking')}</span>
                          </div>
                        )}
                        {msg.content}
                        {msg.isPlanLimit && (
                          <button
                            onClick={() => navigate('/billing')}
                            className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium transition-colors"
                            data-testid="button-help-upgrade-plan"
                          >
                            <Crown className="w-3.5 h-3.5" />
                            {t('planLimit.upgrade')}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
              </div>

              <div className="border-t border-border bg-card p-3 lg:p-4">
                <div className="max-w-2xl mx-auto flex gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputMessage}
                    onChange={e => setInputMessage(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    placeholder={t('help.chatInputPlaceholder')}
                    className="flex-1 bg-secondary/50 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all placeholder:text-muted-foreground"
                    disabled={isLoading}
                    data-testid="input-chat-message"
                  />
                  <Button
                    onClick={sendMessage}
                    disabled={!inputMessage.trim() || isLoading}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white h-10 w-10 p-0 shrink-0"
                    data-testid="button-send-message">
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
