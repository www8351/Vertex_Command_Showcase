import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { isRTL } from "@/i18n";
import { Handshake, ExternalLink, CheckCircle2, Star, Shield, TrendingUp, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Partner {
  id: string;
  name: string;
  nameKey: string;
  descriptionKey: string;
  websiteUrl: string;
  advantages: { key: string; icon: React.ReactNode }[];
  cardClasses: {
    gradient: string;
    border: string;
    iconBg: string;
    iconBorder: string;
    iconText: string;
    advIconText: string;
  };
}

const partners: Partner[] = [
  {
    id: "nostro",
    name: "Nostro",
    nameKey: "partners.nostro.name",
    descriptionKey: "partners.nostro.description",
    websiteUrl: "https://nostro.co.il",
    advantages: [
      { key: "partners.nostro.adv1", icon: <Shield className="w-4 h-4" /> },
      { key: "partners.nostro.adv2", icon: <TrendingUp className="w-4 h-4" /> },
      { key: "partners.nostro.adv3", icon: <Zap className="w-4 h-4" /> },
      { key: "partners.nostro.adv4", icon: <Star className="w-4 h-4" /> },
    ],
    cardClasses: {
      gradient: "bg-gradient-to-br from-blue-500/10 to-cyan-500/10",
      border: "border-blue-500/20",
      iconBg: "bg-blue-500/20",
      iconBorder: "border-blue-500/30",
      iconText: "text-blue-400",
      advIconText: "text-blue-400",
    },
  },
];

export default function Partners() {
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? "rtl" : "ltr";
  const [, navigate] = useLocation();

  return (
    <div dir={dir} className="min-h-screen bg-background">
      <div className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 py-4 flex items-center justify-between rtl:flex-row-reverse">
          <div className="flex items-center gap-3">
            <Handshake className="w-6 h-6 text-blue-500" />
            <h1 className="text-xl font-bold text-foreground" data-testid="text-partners-title">
              {t("partners.title")}
            </h1>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-3 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-foreground" data-testid="text-partners-heading">
            {t("partners.heading")}
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto" data-testid="text-partners-subtitle">
            {t("partners.subtitle")}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6">
          {partners.map((partner) => (
            <div
              key={partner.id}
              className={`${partner.cardClasses.gradient} border ${partner.cardClasses.border} rounded-2xl p-6 sm:p-8 space-y-6`}
              data-testid={`card-partner-${partner.id}`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className={`w-14 h-14 rounded-xl ${partner.cardClasses.iconBg} border ${partner.cardClasses.iconBorder} flex items-center justify-center`}>
                    <span className={`${partner.cardClasses.iconText} font-bold text-xl`}>
                      {partner.name.charAt(0)}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-foreground" data-testid={`text-partner-name-${partner.id}`}>
                      {t(partner.nameKey)}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      <span className="text-xs font-medium text-emerald-500" data-testid={`text-partner-verified-${partner.id}`}>
                        {t("partners.verified")}
                      </span>
                    </div>
                  </div>
                </div>
                <a
                  href={partner.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid={`link-partner-website-${partner.id}`}
                >
                  <Button className="gap-2 bg-blue-600 hover:bg-blue-700 text-white">
                    {t("partners.visitWebsite")}
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </a>
              </div>

              <p className="text-sm text-muted-foreground leading-relaxed" data-testid={`text-partner-desc-${partner.id}`}>
                {t(partner.descriptionKey)}
              </p>

              <div>
                <h4 className="text-sm font-semibold text-foreground mb-3">
                  {t("partners.advantages")}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {partner.advantages.map((adv, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-3 bg-background/60 border border-border rounded-xl px-4 py-3"
                      data-testid={`text-partner-adv-${partner.id}-${idx}`}
                    >
                      <div className={partner.cardClasses.advIconText}>
                        {adv.icon}
                      </div>
                      <span className="text-sm text-foreground">{t(adv.key)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-card border border-border rounded-xl p-6 text-center space-y-3" data-testid="card-partners-cta">
          <h3 className="font-semibold text-foreground">{t("partners.becomePartner")}</h3>
          <p className="text-sm text-muted-foreground max-w-lg mx-auto">
            {t("partners.becomePartnerDesc")}
          </p>
        </div>
      </div>
    </div>
  );
}
