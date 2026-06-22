import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { isRTL } from "@/i18n";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BackButtonProps {
  to?: string;
  label?: string;
  variant?: "ghost" | "outline" | "default";
  size?: "default" | "sm" | "icon";
  className?: string;
  "data-testid"?: string;
}

export default function BackButton({
  to = "/",
  label,
  variant = "ghost",
  size = "icon",
  className = "",
  "data-testid": testId = "button-back",
}: BackButtonProps) {
  const [, navigate] = useLocation();
  const { t, i18n } = useTranslation();
  const rtl = isRTL(i18n.language);

  const ArrowIcon = rtl ? ArrowLeft : ArrowRight;

  const displayLabel = label ?? (size !== "icon" ? t("common.back") : undefined);

  return (
    <Button
      variant={variant}
      size={size}
      onClick={() => navigate(to)}
      className={`${displayLabel ? "gap-2" : ""} ${className}`}
      data-testid={testId}
    >
      <ArrowIcon className={size === "icon" ? "w-5 h-5" : "w-4 h-4"} />
      {displayLabel}
    </Button>
  );
}
