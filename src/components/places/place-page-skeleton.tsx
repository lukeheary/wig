"use client";

export function PlacePageSkeleton() {
  return (
    <div className="bg-background pb-8">
      <div className="container mx-auto animate-pulse">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="h-24 w-24 flex-shrink-0 rounded-2xl bg-muted md:h-32 md:w-32" />
            <div>
              <div className="h-8 w-40 rounded-full bg-muted md:h-9 md:w-56" />
              <div className="mt-2 h-5 w-24 rounded-full bg-muted" />
              <div className="flex flex-wrap gap-2 pt-2">
                <div className="h-7 w-24 rounded-full bg-muted" />
                <div className="h-7 w-20 rounded-full bg-muted" />
              </div>
            </div>
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <div className="h-10 w-28 rounded-full bg-muted" />
            <div className="h-10 w-10 rounded-full bg-muted" />
          </div>
        </div>

        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <div className="h-4 w-[80%] rounded-full bg-muted" />
            <div className="h-4 w-[65%] rounded-full bg-muted" />
          </div>

          <div className="space-y-3">
            <div className="h-4 w-32 rounded-full bg-muted" />
            <div className="h-4 w-40 rounded-full bg-muted" />
          </div>

          <div className="flex items-center gap-2 md:hidden">
            <div className="h-10 flex-1 rounded-full bg-muted" />
            <div className="h-10 w-10 rounded-full bg-muted" />
          </div>
        </div>

        <div className="mt-8 space-y-2">
          <div className="h-7 w-40 rounded-full bg-muted" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={`place-page-skeleton-card-${index}`}
                className="rounded-2xl bg-card p-2 shadow-sm"
              >
                <div className="flex md:block">
                  <div className="h-24 w-24 shrink-0 rounded-2xl bg-muted md:aspect-square md:h-auto md:w-full" />
                  <div className="flex-1 space-y-2 py-2 pl-3 pr-1 md:px-3 md:py-3">
                    <div className="h-4 w-3/4 rounded-full bg-muted" />
                    <div className="h-3 w-1/2 rounded-full bg-muted" />
                    <div className="h-3 w-2/3 rounded-full bg-muted" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
