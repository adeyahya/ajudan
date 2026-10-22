import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { languageName, LANGUAGES } from "@/lib/language";
import { cn } from "@/lib/utils";

/** Form field (name="language") for a business's primary language. */
export function LanguageSelect({
  id,
  defaultValue,
  size = "default",
  className,
}: {
  id?: string;
  defaultValue: string;
  size?: "sm" | "default";
  className?: string;
}) {
  return (
    <Select name="language" defaultValue={defaultValue}>
      <SelectTrigger id={id} size={size} className={cn("w-full", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LANGUAGES.map((l) => (
          <SelectItem key={l.code} value={l.code}>
            {languageName(l.code)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
