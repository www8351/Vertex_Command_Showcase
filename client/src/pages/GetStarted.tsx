import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import { isRTL } from "@/i18n";
import {
  Crown, Plug, Users, FileText, Copy, ArrowRight,
  Check, ChevronRight, Rocket
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface StepConfig {
  icon: any;
  titleKey: string;
  titleDefault: string;
  descKey: string;
  descDefault: string;
  actionKey: string;
  actionDefault: string;
  route: string;
  checkFn?: (data: any) => boolean;
}

const STEPS: StepConfig[] = [
  {
    icon: Crown,
    titleKey: "getStarted.choosePlan",
    titleDefault: "בחר תוכנית",
    descKey: "getStarted.choosePlanDesc",
    descDefault: "התחל עם תקופת ניסיון או בחר תוכנית מנוי לגישה לכל התכונות.",
    actionKey: "getStarted.viewPlans",
    actionDefault: "צפה בתוכניות",
    route: "/billing",
  },
  {
    icon: Plug,
    titleKey: "getStarted.addConnection",
    titleDefault: "הוסף חיבור",
    descKey: "getStarted.addConnectionDesc",
    descDefault: "צור חיבור בין הפלטפורמה לברוקר שלך כדי לייבא חשבונות מסחר.",
    actionKey: "getStarted.addConnectionBtn",
    actionDefault: "הוסף חיבור",
    route: "/integrations",
  },
  {
    icon: Users,
    titleKey: "getStarted.enableAccounts",
    titleDefault: "הפעל חשבונות",
    descKey: "getStarted.enableAccountsDesc",
    descDefault: "הפעל את חשבונות המסחר שלך בפרטי החיבור כדי להתחיל קופי טריידינג.",
    actionKey: "getStarted.enableBtn",
    actionDefault: "הפעל חשבון",
    route: "/integrations",
  },
  {
    icon: FileText,
    titleKey: "getStarted.importContract",
    titleDefault: "ייבא חוזה",
    descKey: "getStarted.importContractDesc",
    descDefault: "ייבא את החוזים שאתה רוצה לסחור בהם.",
    actionKey: "getStarted.importBtn",
    actionDefault: "ייבא חוזה",
    route: "/integrations",
  },
  {
    icon: Copy,
    titleKey: "getStarted.setLeader",
    titleDefault: "הגדר חשבון מוביל ועוקבים",
    descKey: "getStarted.setLeaderDesc",
    descDefault: "הגדר חשבון מוביל כדי להעתיק עסקאות לחשבונות העוקבים שלך.",
    actionKey: "getStarted.setLeaderBtn",
    actionDefault: "הגדר מוביל",
    route: "/copy-trading",
  },
];

export default function GetStarted() {
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? "rtl" : "ltr";
  const [, navigate] = useLocation();
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  const accountsQuery = useQuery<any[]>({
    queryKey: ["/api/v1/accounts"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const completedCount = completedSteps.size;
  const totalSteps = STEPS.length;

  return (
    <div className="min-h-screen bg-background" dir={dir}>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-8">

        <div className="flex items-center justify-between">
          <div className="w-8" />
        </div>

        <div className="text-center space-y-3">
          <div className="w-14 h-14 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center mx-auto">
            <Rocket className="w-7 h-7 text-indigo-400" />
          </div>
          <h1 className="text-2xl font-bold" data-testid="text-get-started-title">
            {t("getStarted.title", { defaultValue: "התחל עם Vertex Command" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("getStarted.subtitle", { defaultValue: "השלם את השלבים הבאים כדי להפעיל את כל כוחות הסנכרון האוטומטי." })}
          </p>
          <p className="text-xs text-muted-foreground" data-testid="text-progress">
            {completedCount}/{totalSteps}
          </p>
        </div>

        <div className="space-y-3">
          {STEPS.map((step, idx) => {
            const done = completedSteps.has(idx);
            const StepIcon = step.icon;
            return (
              <Card
                key={idx}
                className={`bg-card border-border transition-colors ${done ? 'border-emerald-500/30 bg-emerald-500/5' : 'hover:border-indigo-500/30'}`}
                data-testid={`card-step-${idx}`}
              >
                <CardContent className="p-4 sm:p-5 flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${done ? 'bg-emerald-500/20' : 'bg-indigo-500/20'}`}>
                    {done ? (
                      <Check className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <StepIcon className="w-5 h-5 text-indigo-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${done ? 'text-emerald-400 line-through' : ''}`}>
                      {t(step.titleKey, { defaultValue: step.titleDefault })}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t(step.descKey, { defaultValue: step.descDefault })}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={done ? "outline" : "default"}
                    className={done ? "" : "bg-indigo-600 hover:bg-indigo-700"}
                    onClick={() => {
                      setCompletedSteps(prev => { const n = new Set(prev); n.add(idx); return n; });
                      navigate(step.route);
                    }}
                    data-testid={`btn-step-${idx}`}
                  >
                    {t(step.actionKey, { defaultValue: step.actionDefault })}
                    <ChevronRight className="w-3.5 h-3.5 ms-1" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

      </div>
    </div>
  );
}
