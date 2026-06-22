import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";

const LANGUAGES = [
  { code: 'he', flag: '🇮🇱' },
  { code: 'en', flag: '🇺🇸' },
  { code: 'ar', flag: '🇸🇦' },
  { code: 'es', flag: '🇪🇸' },
] as const;

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="w-7 h-7 lg:w-8 lg:h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          data-testid="button-language-switcher"
        >
          <Globe className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="bg-card border-border min-w-[140px]">
        <DropdownMenuLabel>{t('lang.switch')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {LANGUAGES.map(({ code, flag }) => (
          <DropdownMenuCheckboxItem
            key={code}
            checked={i18n.language.split('-')[0] === code}
            onCheckedChange={() => i18n.changeLanguage(code)}
            data-testid={`lang-option-${code}`}
          >
            <span className="mr-2">{flag}</span> {t(`lang.${code}`)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
