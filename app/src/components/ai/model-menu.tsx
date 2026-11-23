import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Check, ChevronDown } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { chipClass } from "@/components/ui/chip";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { resolveChoice, storedChoice, type Choice } from "@/new-job/types";

type Props = {
  model: string;
  effort: string;
  models: readonly Choice[];
  efforts: readonly Choice[];
  header?: string;
  onChange: (next: { model: string; effort: string }) => void;
};

const choiceOf = (items: readonly Choice[], value: string) => items.find((item) => item.value === value);

function DefaultTag() {
  return <span className="text-label font-normal text-faint">Default</span>;
}

function ModelOption({ item }: { item: Choice }) {
  const id = useId();
  return (
    <Radio.Root
      value={item.value}
      aria-labelledby={`${id}-name`}
      aria-describedby={item.hint && `${id}-hint`}
      className="group grid cursor-default grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-2 py-1.5 text-left outline-none ui-focus-inset transition-colors duration-(--duration-press) hover:bg-active data-[checked]:bg-active"
    >
      <span className="flex items-baseline gap-2">
        <span id={`${id}-name`} className="text-body font-medium text-ink">
          {item.label}
        </span>
        {item.isDefault && <DefaultTag />}
      </span>
      <Check aria-hidden className="row-span-2 size-4 text-accent-text opacity-0 group-data-[checked]:opacity-100" />
      {item.hint && (
        <span id={`${id}-hint`} className="text-label text-muted">
          {item.hint}
        </span>
      )}
    </Radio.Root>
  );
}

function EffortBars({ level, total, className }: { level: number; total: number; className?: string }) {
  return (
    <span aria-hidden className={cn("flex h-3 items-end gap-[2px]", className)}>
      {Array.from({ length: total }, (_, index) => (
        <span key={index} className={cn("w-[3px] rounded-[1px]", index < level ? "bg-current" : "bg-current opacity-25")} style={{ height: `${((index + 1) / total) * 100}%` }} />
      ))}
    </span>
  );
}

function EffortStep({ item, level, total }: { item: Choice; level: number; total: number }) {
  return (
    <Radio.Root
      value={item.value}
      aria-label={item.label}
      className="group flex flex-1 cursor-default flex-col items-center justify-center gap-1 rounded-md px-1 py-1.5 text-caption font-medium text-muted outline-none ui-focus-inset transition-[background-color,color,box-shadow] duration-(--duration-press) hover:text-ink data-[checked]:bg-surface data-[checked]:text-ink data-[checked]:shadow-[0_0_0_1px_var(--edge)]"
    >
      <EffortBars level={level} total={total} className="group-data-[checked]:text-accent-text" />
      <span className="whitespace-nowrap">{item.label}</span>
    </Radio.Root>
  );
}

export function ModelMenu({ model, effort, models, efforts, header = "Model", onChange }: Props) {
  const id = useId();
  const modelValue = resolveChoice(models, model);
  const effortValue = resolveChoice(efforts, effort);
  const modelLabel = choiceOf(models, modelValue)?.label ?? (modelValue || "Default");
  const chosenEffort = choiceOf(efforts, effortValue);
  const effortLabel = chosenEffort?.label ?? (effortValue || "Default");
  const choice = `${modelLabel} · ${effortLabel}`;
  const level = efforts.findIndex((item) => item.value === effortValue) + 1;
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="xs" aria-label={`Model, ${choice}`} className={chipClass} />}>
        <span>{modelLabel}</span>
        <span className="sr-only"> · </span>
        {level > 0 && <EffortBars level={level} total={efforts.length} className="text-accent-text" />}
        <span className="text-muted">{effortLabel}</span>
        <ChevronDown aria-hidden className="size-3 text-faint" />
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-80 gap-0 p-1.5">
        <p id={`${id}-models`} className="ui-overline px-2 pb-1 pt-1 text-faint">
          {header}
        </p>
        <RadioGroup aria-labelledby={`${id}-models`} value={modelValue} onValueChange={(next) => onChange({ model: storedChoice(models, String(next)), effort })} className="flex flex-col gap-0.5">
          {models.map((item) => (
            <ModelOption key={item.value} item={item} />
          ))}
        </RadioGroup>
        <div role="none" className="-mx-1.5 my-1.5 h-px bg-edge" />
        <div className="flex flex-col gap-2 px-2 pb-1.5 pt-1">
          <p id={`${id}-effort`} className="ui-overline text-faint">
            Effort
          </p>
          <RadioGroup aria-labelledby={`${id}-effort`} value={effortValue} onValueChange={(next) => onChange({ model, effort: storedChoice(efforts, String(next)) })} className="flex gap-0.5 rounded-lg bg-active p-0.5">
            {efforts.map((item, index) => (
              <EffortStep key={item.value} item={item} level={index + 1} total={efforts.length} />
            ))}
          </RadioGroup>
          <p aria-live="polite" className="flex min-h-4 items-baseline justify-between gap-3 text-label text-pretty text-muted">
            <span>{chosenEffort?.hint}</span>
            {chosenEffort?.isDefault && <DefaultTag />}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
