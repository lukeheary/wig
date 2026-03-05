"use client";

import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { BackButtonHeader } from "@/components/shared/back-button-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2 } from "lucide-react";

type CategoryDraft = {
  key: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
};

function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted-foreground/40",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-5 w-5 transform rounded-full bg-background transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        ].join(" ")}
      />
    </button>
  );
}

export default function AdminCategoriesPage() {
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: categories, isLoading } = trpc.admin.listCategories.useQuery();
  const categoryById = useMemo(
    () =>
      new Map((categories || []).map((category) => [category.id, category])),
    [categories]
  );
  const createCategory = trpc.admin.createCategory.useMutation({
    onSuccess: () => {
      // toast({ title: "Category created" });
      utils.admin.listCategories.invalidate();
      utils.category.listActive.invalidate();
      setNewCategory({
        key: "",
        label: "",
        sortOrder: (categories?.length || 0) * 10 + 10,
        isActive: true,
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteCategory = trpc.admin.deleteCategory.useMutation({
    onSuccess: (deleted) => {
      toast({ title: "Category deleted" });
      utils.admin.listCategories.setData(undefined, (prev) =>
        prev?.filter((category) => category.id !== deleted.id)
      );
      utils.category.listActive.invalidate();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateCategory = trpc.admin.updateCategory.useMutation({
    onSuccess: (updated, variables) => {
      const isToggleOnly =
        variables.key === undefined &&
        variables.label === undefined &&
        variables.sortOrder === undefined;

      // if (!isToggleOnly) {
      //   toast({ title: "Category updated" });
      // }

      utils.admin.listCategories.setData(undefined, (prev) =>
        prev?.map((category) =>
          category.id === updated.id ? { ...category, ...updated } : category
        )
      );

      setDrafts((prev) => {
        const current = prev[updated.id];
        if (!current) return prev;

        return {
          ...prev,
          [updated.id]: isToggleOnly
            ? {
                ...current,
                isActive: updated.isActive,
              }
            : {
                key: updated.key,
                label: updated.label,
                sortOrder: updated.sortOrder,
                isActive: updated.isActive,
              },
        };
      });

      utils.category.listActive.invalidate();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
      utils.admin.listCategories.invalidate();
    },
  });

  const [drafts, setDrafts] = useState<Record<string, CategoryDraft>>({});
  const [newCategory, setNewCategory] = useState<CategoryDraft>({
    key: "",
    label: "",
    sortOrder: 10,
    isActive: true,
  });

  useEffect(() => {
    if (!categories) return;

    setDrafts((prev) => {
      const next = { ...prev };
      const validIds = new Set(categories.map((category) => category.id));

      for (const category of categories) {
        if (!next[category.id]) {
          next[category.id] = {
            key: category.key,
            label: category.label,
            sortOrder: category.sortOrder,
            isActive: category.isActive,
          };
        }
      }

      for (const categoryId of Object.keys(next)) {
        if (!validIds.has(categoryId)) {
          delete next[categoryId];
        }
      }

      return next;
    });
  }, [categories]);

  const sortedCategories = useMemo(
    () =>
      [...(categories || [])].sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.label.localeCompare(b.label);
      }),
    [categories]
  );

  const handleSave = (categoryId: string) => {
    const draft = drafts[categoryId];
    if (!draft) return;

    if (!draft.key.trim() || !draft.label.trim()) {
      toast({
        title: "Validation error",
        description: "Key and label are required",
        variant: "destructive",
      });
      return;
    }

    updateCategory.mutate({
      id: categoryId,
      key: draft.key.trim().toLowerCase(),
      label: draft.label.trim(),
      sortOrder: draft.sortOrder,
      isActive: draft.isActive,
    });
  };

  const handleToggleActive = (categoryId: string, nextIsActive: boolean) => {
    const draft = drafts[categoryId];
    if (!draft) return;

    setDrafts((prev) => ({
      ...prev,
      [categoryId]: {
        ...prev[categoryId]!,
        isActive: nextIsActive,
      },
    }));

    updateCategory.mutate({
      id: categoryId,
      isActive: nextIsActive,
    });
  };

  const hasDraftChanges = (categoryId: string) => {
    const draft = drafts[categoryId];
    const saved = categoryById.get(categoryId);

    if (!draft || !saved) return false;

    const normalizedDraft = {
      key: draft.key.trim().toLowerCase(),
      label: draft.label.trim(),
      sortOrder: draft.sortOrder,
      isActive: draft.isActive,
    };

    return (
      normalizedDraft.key !== saved.key ||
      normalizedDraft.label !== saved.label ||
      normalizedDraft.sortOrder !== saved.sortOrder ||
      normalizedDraft.isActive !== saved.isActive
    );
  };

  const isDraftValid = (categoryId: string) => {
    const draft = drafts[categoryId];
    if (!draft) return false;
    return draft.key.trim().length > 0 && draft.label.trim().length > 0;
  };

  const handleCreate = () => {
    if (!newCategory.key.trim() || !newCategory.label.trim()) {
      toast({
        title: "Validation error",
        description: "Key and label are required",
        variant: "destructive",
      });
      return;
    }

    createCategory.mutate({
      key: newCategory.key.trim().toLowerCase(),
      label: newCategory.label.trim(),
      sortOrder: newCategory.sortOrder,
      isActive: newCategory.isActive,
    });
  };

  return (
    <div className="space-y-6">
      <BackButtonHeader backHref="/admin" title="Categories" />

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="text-sm font-medium">Create Category</div>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_120px_120px_auto]">
            <Input
              placeholder="key (e.g. clubs)"
              value={newCategory.key}
              onChange={(e) =>
                setNewCategory((prev) => ({ ...prev, key: e.target.value }))
              }
            />
            <Input
              placeholder="Label (e.g. Clubs)"
              value={newCategory.label}
              onChange={(e) =>
                setNewCategory((prev) => ({ ...prev, label: e.target.value }))
              }
            />
            <Input
              type="number"
              min={0}
              value={newCategory.sortOrder}
              onChange={(e) =>
                setNewCategory((prev) => ({
                  ...prev,
                  sortOrder: Number(e.target.value) || 0,
                }))
              }
            />
            <div className="flex items-center gap-2 px-2">
              <Toggle
                checked={newCategory.isActive}
                onChange={(next) =>
                  setNewCategory((prev) => ({
                    ...prev,
                    isActive: next,
                  }))
                }
              />
              <span className="text-sm text-muted-foreground">
                {newCategory.isActive ? "Active" : "Inactive"}
              </span>
            </div>
            <Button onClick={handleCreate} disabled={createCategory.isPending}>
              {createCategory.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Create
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {isLoading && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading &&
          sortedCategories.map((category) => {
            const draft = drafts[category.id];
            if (!draft) return null;

            return (
              <Card key={category.id}>
                <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_1fr_120px_120px_auto_auto]">
                  <Input
                    value={draft.key}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [category.id]: {
                          ...draft,
                          key: e.target.value,
                        },
                      }))
                    }
                  />
                  <Input
                    value={draft.label}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [category.id]: {
                          ...draft,
                          label: e.target.value,
                        },
                      }))
                    }
                  />
                  <Input
                    type="number"
                    min={0}
                    value={draft.sortOrder}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [category.id]: {
                          ...draft,
                          sortOrder: Number(e.target.value) || 0,
                        },
                      }))
                    }
                  />
                  <div className="flex items-center gap-2 px-2">
                    <Toggle
                      checked={draft.isActive}
                      disabled={updateCategory.isPending}
                      onChange={(next) => handleToggleActive(category.id, next)}
                    />
                    <span className="text-sm text-muted-foreground">
                      {draft.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <Button
                    onClick={() => handleSave(category.id)}
                    disabled={
                      updateCategory.isPending ||
                      !isDraftValid(category.id) ||
                      !hasDraftChanges(category.id)
                    }
                  >
                    Save
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={() => {
                      if (
                        !confirm(
                          `Delete "${category.label}"? This cannot be undone.`
                        )
                      )
                        return;
                      deleteCategory.mutate({ id: category.id });
                    }}
                    disabled={deleteCategory.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
      </div>
    </div>
  );
}
