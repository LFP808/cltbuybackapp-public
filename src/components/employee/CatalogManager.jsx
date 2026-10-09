"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Input } from "@/components/ui";
import { categoriesOf } from "@/domain/catalog";
import { addCatalogItemAction, setCatalogItemActiveAction } from "@/app/employee/inventory/actions";

/**
 * The catalog as an editable list: add an off-list item (a new iPhone ships
 * every fall), retire one from the pickers without erasing what history means
 * by its name. Grouped by category like the pickers themselves, so what you
 * see here is the shape staff see there.
 */
export function CatalogManager({ items }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [error, setError] = useState(null);

  const categories = categoriesOf(items.length ? items : undefined);
  const chosenCategory = category === "__new__" ? newCategory : category;

  function submit(e) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addCatalogItemAction({ name, category: chosenCategory });
      if (result?.error) {
        setError(result.error);
        return;
      }
      setName("");
      setNewCategory("");
      router.refresh();
    });
  }

  function toggle(item) {
    startTransition(async () => {
      const result = await setCatalogItemActiveAction(item.id, !item.active);
      if (result?.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <Input
              label="Add an item"
              placeholder="e.g. iPhone 17 Pro Max"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink">Category</span>
            <select
              className="h-9 rounded-lg border border-line bg-white px-3 text-[14px]"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Pick…</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
              <option value="__new__">New category…</option>
            </select>
          </label>
          {category === "__new__" && (
            <div className="min-w-[160px]">
              <Input
                label="New category"
                placeholder="e.g. Samsung"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
              />
            </div>
          )}
          <Button type="submit" disabled={pending || !name.trim() || !chosenCategory.trim()}>
            Add item
          </Button>
        </form>
        {error && <p className="mt-2 text-[13px] text-destructive">{error}</p>}
      </Card>

      {categories.map((cat) => (
        <Card key={cat}>
          <div className="mb-2 text-[13px] font-bold text-accent">{cat}</div>
          <div className="divide-y divide-line">
            {items
              .filter((i) => i.category === cat)
              .map((i) => (
                <div key={i.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span
                    className={`text-[13px] ${i.active ? "text-ink" : "text-muted line-through"}`}
                  >
                    {i.name}
                  </span>
                  <Button variant="subtle" size="sm" disabled={pending} onClick={() => toggle(i)}>
                    {i.active ? "Retire" : "Restore"}
                  </Button>
                </div>
              ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
