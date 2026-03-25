"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface LandingExplainer {
  title: string;
  description: string;
}

const CARD_STYLES = [
  {
    accent: "from-[#7dd3fc]/18 via-transparent to-transparent",
  },
  {
    accent: "from-[#f9a8d4]/16 via-transparent to-transparent",
  },
  {
    accent: "from-[#fde68a]/16 via-transparent to-transparent",
  },
] as const;

export function LandingExplainerCards({
  items,
}: {
  items: LandingExplainer[];
}) {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const [hasScrolled, setHasScrolled] = useState(false);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setHasScrolled(window.scrollY > 0);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      {
        threshold: 0.15,
      }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  const shouldReveal = hasScrolled && isInView;

  return (
    <div ref={sectionRef} className="grid gap-5 md:grid-cols-3">
      {items.map(({ title, description }, index) => {
        const style = CARD_STYLES[index % CARD_STYLES.length];

        return (
          <div
            key={title}
            className={cn(
              "group relative overflow-hidden rounded-[28px] border border-white/10 bg-[#1a1a1d]/95 p-5 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.7)] backdrop-blur transition-all duration-700 ease-out md:min-h-[176px]",
              shouldReveal
                ? "translate-y-0 opacity-100"
                : "translate-y-8 opacity-0"
            )}
            style={{
              transitionDelay: shouldReveal ? `${index * 140}ms` : "0ms",
            }}
          >
            <div
              className={cn(
                "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-100",
                style.accent
              )}
            />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px" />
            <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full transition-transform duration-700 group-hover:scale-110" />

            <div className="relative mt-5 flex h-full flex-col items-center text-center">
              <div className="flex w-full items-baseline justify-center gap-4">
                <h4 className="font-space-grotesk whitespace-nowrap text-2xl font-semibold leading-none text-foreground">
                  {title}
                </h4>
              </div>

              <div className="flex flex-col items-center space-y-2">
                <div className="bg-white/12 h-px w-12" />
                <p className="text-[base max-w-[32ch] leading-6 text-muted-foreground">
                  {description}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
