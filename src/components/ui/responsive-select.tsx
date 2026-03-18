"use client";

import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Check, ChevronDown } from "lucide-react";

interface ResponsiveSelectOption {
  value: string;
  label: string;
}

interface ResponsiveSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: ResponsiveSelectOption[];
  placeholder?: string;
  title?: string;
  className?: string;
}

export function ResponsiveSelect({
  value,
  onValueChange,
  options,
  placeholder = "Select an option",
  title = "Select",
  className,
}: ResponsiveSelectProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [open, setOpen] = React.useState(false);

  const selectedOption = options.find((opt) => opt.value === value);

  if (isDesktop) {
    return (
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className={className}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          className={cn(
            "flex h-12 w-full items-center justify-between gap-2 rounded-full border border-input bg-muted px-5 py-2 text-sm focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
        >
          <span className="truncate">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="px-0 pb-4 pt-6 outline-none">
        <SheetHeader className="px-6 pb-4 text-left">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="max-h-[60vh] overflow-y-auto px-2">
          {options.map((option) => (
            <button
              key={option.value}
              className={cn(
                "flex w-full items-center justify-between rounded-lg px-4 py-5 text-left transition-colors hover:bg-muted",
                value === option.value && "bg-muted font-medium"
              )}
              onClick={() => {
                onValueChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {value === option.value && (
                <Check className="h-4 w-4 text-primary" />
              )}
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
