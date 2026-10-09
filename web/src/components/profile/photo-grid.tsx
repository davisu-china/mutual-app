import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { api, uploadToPresigned, ApiError, type Photo } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

const MAX = 9;

/**
 * 九宫格相册，支持长按拖拽排序。
 *
 * 实现要点：
 *   1. **长按 180ms 才进入拖拽**。直接按下就拖会和页面滚动打架，
 *      用户想滑页面结果把照片拖走了。
 *   2. 拖拽中用指针位置判定落点，而不是靠 HTML5 的 drag-and-drop API——
 *      后者在移动端基本不可用。
 *   3. 顺序**每次落下就提交**，不攒着等「保存」按钮。顺序是用户的显式意图，
 *      不该因为忘记点保存而丢失。
 *   4. 第一张是封面图，必须一眼看出来，否则拖拽就是盲操作。
 */
export function PhotoGrid({ photos, onChange }: { photos: Photo[]; onChange: (p: Photo[]) => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const holdTimer = useRef<number | null>(null);
  const startedRef = useRef(false);

  const commit = useCallback(
    async (list: Photo[]) => {
      onChange(list);
      try {
        await api.put("/users/me/photos/order", { orderedIds: list.map((p) => p.id) });
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "排序保存失败，请重试", "error");
      }
    },
    [onChange, toast]
  );

  async function upload(files: FileList) {
    const room = MAX - photos.length;
    if (room <= 0) {
      toast("相册已满 9 张，请先删掉一些", "error");
      return;
    }
    setUploading(true);
    try {
      const next = [...photos];
      for (const file of Array.from(files).slice(0, room)) {
        const pre = await api.post<{ uploadUrl: string; objectKey: string }>(
          "/users/me/photos/presign",
          { contentType: file.type || "image/jpeg" }
        );
        await uploadToPresigned(pre.uploadUrl, file);
        const saved = await api.post<Photo>("/users/me/photos/confirm", {
          objectKey: pre.objectKey,
        });
        next.push(saved);
      }
      onChange(next);
      toast(`已上传 ${Math.min(files.length, room)} 张`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "上传失败，请重试", "error");
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: number) {
    if (photos.length <= 1) {
      toast("至少保留一张照片", "error");
      return;
    }
    try {
      await api.del(`/users/me/photos/${id}`);
      onChange(photos.filter((p) => p.id !== id));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "删除失败", "error");
    }
  }

  // ---- 拖拽 ----
  function onPointerDown(e: React.PointerEvent, idx: number) {
    if (uploading) return;
    startedRef.current = false;
    holdTimer.current = window.setTimeout(() => {
      startedRef.current = true;
      setDragIdx(idx);
      haptic(12);
    }, 180);
    void e;
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!startedRef.current) {
      // 还没进入拖拽就移动了手指 —— 用户其实是想滚页面，取消长按
      if (holdTimer.current) {
        window.clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }
      return;
    }
    if (dragIdx === null || !gridRef.current) return;
    e.preventDefault();

    const rect = gridRef.current.getBoundingClientRect();
    const cellW = rect.width / 3;
    const col = Math.floor((e.clientX - rect.left) / cellW);
    const row = Math.floor((e.clientY - rect.top) / cellW);
    const idx = row * 3 + col;
    if (idx >= 0 && idx < photos.length && idx !== dragIdx) {
      setOverIdx(idx);
      // 实时交换，拖到哪儿就即时看到效果
      const next = [...photos];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(idx, 0, moved);
      onChange(next);
      setDragIdx(idx);
    }
  }

  function onPointerUp() {
    if (holdTimer.current) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (startedRef.current && dragIdx !== null) {
      void commit(photos);
      haptic(8);
    }
    startedRef.current = false;
    setDragIdx(null);
    setOverIdx(null);
  }

  useEffect(() => {
    return () => {
      if (holdTimer.current) window.clearTimeout(holdTimer.current);
    };
  }, []);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[15px] text-muted">
          我的相册 <span className="text-[12px] text-muted-2">长按拖拽排序</span>
        </span>
        <span className="text-[12px] tabular-nums text-muted-2">{photos.length}/{MAX}</span>
      </div>

      <div
        ref={gridRef}
        className="grid grid-cols-3 gap-1.5"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ touchAction: dragIdx !== null ? "none" : undefined }}
      >
        {photos.map((p, i) => (
          <div
            key={p.id}
            onPointerDown={(e) => onPointerDown(e, i)}
            className={cn(
              "relative aspect-square overflow-hidden rounded-[9px] bg-line-soft transition-transform",
              dragIdx === i ? "z-10 scale-[1.04] shadow-card" : "",
              overIdx === i && dragIdx !== i ? "ring-2 ring-brand" : ""
            )}
          >
            <img src={p.url} alt="" draggable={false} className="h-full w-full object-cover" />
            {i === 0 && (
              <span className="absolute left-1 top-1 rounded bg-black/55 px-1.5 py-[1px] text-[9px] text-white">
                主图
              </span>
            )}
            {p.auditStatus !== "approved" && (
              <span className="absolute inset-x-0 bottom-0 bg-black/55 py-[2px] text-center text-[9px] text-white">
                审核中
              </span>
            )}
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => remove(p.id)}
              className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-[12px] leading-none text-white"
              aria-label="删除"
            >
              <X size={13} strokeWidth={2.8} aria-hidden="true" />
            </button>
          </div>
        ))}

        {photos.length < MAX && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            aria-label="添加照片"
            className="flex aspect-square items-center justify-center rounded-[9px] border-[1.5px] border-dashed border-line text-brand transition-colors hover:border-brand/50 disabled:opacity-50"
          >
            {uploading ? (
              <span className="text-[12px] text-muted-2">上传中</span>
            ) : (
              <ImagePlus size={22} strokeWidth={1.8} aria-hidden="true" />
            )}
          </button>
        )}
      </div>

      <p className="mt-2 text-[11.5px] leading-relaxed text-muted-2">
        第 1 张就是你的头像与封面，会出现在划卡、广场和聊天列表里
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void upload(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
