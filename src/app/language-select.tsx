import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { languageName, LANGUAGES } from "@/lib/language";

/** Form field (name="language") for a business's primary language. */
export function LanguageSelect({ id, defaultValue }: { id?: string; defaultValue: string }) {
  return (
    <Select name="language" defaultValue={defaultValue}>
      <SelectTrigger id={id} className="w-full">
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
