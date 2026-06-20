"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UploadCloud, FileText, Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { ProfileResponse } from "@/lib/api";

type FileRow = { id: string; name: string; path: string; size: number; pages: number };

export function ResumeUpload({ files }: { files: FileRow[] }) {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<FileRow | null>(null);

  const upload = useMutation({
    mutationFn: async (accepted: File[]) => {
      const fd = new FormData();
      accepted.forEach((f) => fd.append("files", f));
      const res = await fetch("/api/resume", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Upload failed");
      return (await res.json()) as ProfileResponse;
    },
    onSuccess: () => {
      toast.success("Resume parsed and profile updated.");
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["strength"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onDrop = useCallback(
    (accepted: File[], rejected: { file: File }[]) => {
      if (rejected.length) toast.error("Only PDF files are supported.");
      if (accepted.length) upload.mutate(accepted);
    },
    [upload]
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    multiple: true,
    noClick: true,
    noKeyboard: true,
  });

  return (
    <div>
      <div
        {...getRootProps()}
        className={cn(
          "relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors",
          isDragActive ? "border-brand bg-brand-soft" : "border-border bg-surface-2/40"
        )}
      >
        <input {...getInputProps()} />
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          {upload.isPending ? <Loader2 className="animate-spin" /> : <UploadCloud />}
        </div>
        <div className="mt-3 text-sm font-medium">
          {upload.isPending ? "Parsing your resume…" : "Drag & drop your resume here"}
        </div>
        <div className="mt-1 text-xs text-ink-faint">PDF only · multiple files supported</div>
        <Button className="mt-4" size="sm" onClick={open} disabled={upload.isPending}>
          Browse files
        </Button>
      </div>

      {files.length > 0 && (
        <div className="mt-4 space-y-2">
          {files.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-danger-soft text-danger">
                <FileText size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{f.name}</div>
                <div className="text-xs text-ink-faint">
                  {(f.size / 1024).toFixed(0)} KB{f.pages ? ` · ${f.pages} pages` : ""}
                </div>
              </div>
              <button
                onClick={() => setPreview(f)}
                title="Preview"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface-2 hover:text-brand"
              >
                <Eye size={18} />
              </button>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.name} className="max-w-4xl">
        {preview && (
          <iframe src={preview.path} title={preview.name} className="h-[75vh] w-full bg-surface-2" />
        )}
      </Modal>
    </div>
  );
}
