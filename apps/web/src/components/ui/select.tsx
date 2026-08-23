import { Select as SelectPrimitive } from "@base-ui/react/select";
import { TbCheck, TbChevronDown } from "react-icons/tb";

export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
}

interface SelectControlProps {
  ariaLabel: string;
  value: string | null;
  options: readonly SelectOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
}

export function SelectControl({ ariaLabel, value, options, onValueChange, placeholder }: SelectControlProps) {
  return (
    <SelectPrimitive.Root
      items={options}
      value={value}
      onValueChange={(next) => { if (typeof next === "string") onValueChange(next); }}
    >
      <SelectPrimitive.Trigger data-slot="select-trigger" aria-label={ariaLabel}>
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon><TbChevronDown /></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          data-slot="select-positioner"
          align="start"
          alignItemWithTrigger={false}
          sideOffset={5}
        >
          <SelectPrimitive.Popup data-slot="select-content">
            <SelectPrimitive.List data-slot="select-list">
              {options.map((option) => (
                <SelectPrimitive.Item
                  data-slot="select-item"
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                >
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator><TbCheck /></SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
