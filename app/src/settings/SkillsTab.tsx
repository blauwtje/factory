import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { setSkillEnabled } from "@/ipc";

export function SkillSwitch({ name, enabled, onChanged }: { name: string; enabled: boolean; onChanged: () => void }) {
  const [base, setBase] = useState(enabled);
  const [on, setOn] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  if (base !== enabled) {
    setBase(enabled);
    setOn(enabled);
  }

  async function toggle(next: boolean) {
    setOn(next);
    try {
      await setSkillEnabled(name, next);
      setError(null);
      onChanged();
    } catch (reason) {
      setError(String(reason));
      setOn(!next);
    }
  }

  return (
    <span className="flex items-center justify-end gap-2">
      {error && (
        <span role="alert" title={error} className="whitespace-nowrap text-label text-failed-ink">
          Not saved
        </span>
      )}
      <Switch aria-label={name} checked={on} onCheckedChange={toggle} />
    </span>
  );
}
