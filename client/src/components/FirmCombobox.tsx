import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

interface FirmComboboxProps {
  value: string;
  onChange: (val: string) => void;
  firms: { id: number; name: string }[];
  placeholder?: string;
  testId?: string;
}

export default function FirmCombobox({ value, onChange, firms, placeholder, testId }: FirmComboboxProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder || t('account.firmPlaceholder');
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setSearch(value); }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = firms.filter(f => f.name.toLowerCase().includes(search.toLowerCase()));
  const showCreate = search.trim() && !firms.some(f => f.name === search.trim());

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <Input
          ref={inputRef}
          value={search}
          onChange={e => { setSearch(e.target.value); onChange(e.target.value); setIsOpen(true); }}
          onFocus={() => setIsOpen(true)}
          placeholder={resolvedPlaceholder}
          className="bg-secondary/50 border-border text-sm h-9 pr-8"
          data-testid={testId}
          autoComplete="off"
        />
        <button type="button" onClick={() => { setIsOpen(!isOpen); inputRef.current?.focus(); }}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground">
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>
      {isOpen && (filtered.length > 0 || showCreate) && (
        <div className="absolute z-50 top-full mt-1 w-full bg-card border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
          {filtered.map(f => (
            <button key={f.id} type="button"
              onClick={() => { onChange(f.name); setSearch(f.name); setIsOpen(false); }}
              className={`w-full text-right px-3 py-2 text-sm hover:bg-secondary/50 transition-colors ${f.name === value ? 'bg-secondary/50 font-medium' : ''}`}>
              {f.name}
            </button>
          ))}
          {showCreate && (
            <button type="button"
              onClick={() => { onChange(search.trim()); setIsOpen(false); }}
              className="w-full text-right px-3 py-2 text-sm text-indigo-500 hover:bg-secondary/50 transition-colors border-t border-border">
              + {t('account.createFirm')}: "{search.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}
