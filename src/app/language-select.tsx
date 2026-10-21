import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LANGUAGES } from "@/lib/language";

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
            {l.nativeLabel === l.label ? l.label : `${l.nativeLabel} (${l.label})`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
