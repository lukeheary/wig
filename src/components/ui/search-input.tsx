"use client";

import { forwardRef } from "react";
import { Search, X, ArrowLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  showClear?: boolean;
  showBack?: boolean;
  onBack?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    {
      value,
      onChange,
      placeholder = "Search...",
      className,
      showClear = true,
      showBack = false,
      onBack,
      onFocus,
      onBlur,
    },
    ref
  ) {
    return (
      <div
        className={cn("search-input relative flex items-center", className)}
        style={{ WebkitTapHighlightColor: "transparent" }}
      >
        {/* Back button container - always present, width animates */}
        <div
          className={cn(
            "overflow-hidden transition-all duration-200 ease-out",
            showBack ? "w-12 opacity-100" : "w-0 opacity-0"
          )}
        >
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
            }}
            onPointerDown={(e) => {
              e.preventDefault();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onBack?.();
            }}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:outline-none"
            tabIndex={showBack ? 0 : -1}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        </div>
        <div className="relative flex-1 transition-all duration-200">
          <Search className="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={ref}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
            className={cn(
              "appearance-none pl-10 shadow-none transition-all duration-200 [-webkit-appearance:none] [-webkit-tap-highlight-color:transparent] [box-shadow:none] focus:shadow-none focus-visible:shadow-none",
              showClear && value && "pr-10"
            )}
          />
          {/* Clear button with fade transition */}
          <div
            className={cn(
              "absolute right-3 top-1/2 -translate-y-1/2 transition-opacity duration-150",
              showClear && value
                ? "opacity-100"
                : "pointer-events-none opacity-0"
            )}
          >
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
              }}
              onPointerDown={(e) => {
                e.preventDefault();
              }}
              onClick={() => onChange("")}
              className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              tabIndex={showClear && value ? 0 : -1}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }
);
