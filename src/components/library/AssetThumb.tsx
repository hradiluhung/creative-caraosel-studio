"use client";

import { Film, Music, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { formatSeconds } from "@/document/timing";
import { getAssetPreview } from "@/persistence/db";
import type { LibraryItem } from "@/persistence/libraryModel";
import { useObjectUrl } from "@/lib/useObjectUrl";
import { cn } from "@/lib/cn";

/** Square preview of a stored asset. Loads its picture lazily from IndexedDB. */
export function AssetThumb({ item, className, hideStar = false }: { item: LibraryItem; className?: string; hideStar?: boolean }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    let live = true;
    void getAssetPreview(item.id).then((b) => live && setBlob(b ?? null));
    return () => {
      live = false;
    };
  }, [item.id]);
  const url = useObjectUrl(blob);
  return (
    <span className={cn("relative flex aspect-square items-center justify-center overflow-hidden rounded-[5px] border border-line bg-sunken", className)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- local blob preview
        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" draggable={false} />
      ) : item.kind === "audio" ? (
        <Music className="h-5 w-5 text-muted" />
      ) : item.kind === "video" ? (
        <Film className="h-5 w-5 text-muted" />
      ) : null}
      {item.favorite && !hideStar && <Star className="absolute top-1 left-1 h-3.5 w-3.5 fill-amber-400 text-amber-400 drop-shadow" aria-label="Favorite" />}
      {item.duration !== undefined && (
        <span className="absolute right-1 bottom-1 rounded-[3px] bg-black/65 px-1 text-[10px] leading-4 text-white tabular-nums">{formatSeconds(item.duration)}</span>
      )}
    </span>
  );
}
