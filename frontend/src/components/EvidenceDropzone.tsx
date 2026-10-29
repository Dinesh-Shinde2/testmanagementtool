import { Upload } from "lucide-react";
import { useRef, useState } from "react";

/** Drag-drop + click file picker for execution evidence. Upload is optional on Fail. */
export function EvidenceDropzone({
  disabled,
  busy,
  onFiles,
  hint = "Optional on Fail — screenshots or logs help retest.",
}: {
  disabled?: boolean;
  busy?: boolean;
  onFiles: (files: File[]) => void;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function take(list: FileList | File[] | null) {
    if (!list || disabled) return;
    const files = Array.from(list).filter(Boolean);
    if (files.length) onFiles(files);
  }

  return (
    <div>
      <div
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-5 text-center transition-colors ${
          over ? "border-brand bg-brand-soft" : "border-line bg-slate-50/80 hover:border-brand/50 hover:bg-brand-soft/50"
        } ${disabled ? "pointer-events-none opacity-50" : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        aria-label="Upload evidence"
      >
        <Upload size={18} className="text-brand" aria-hidden />
        <p className="mt-2 text-sm font-medium text-ink">{busy ? "Uploading…" : "Drop evidence here or click to browse"}</p>
        <p className="mt-0.5 text-[11px] text-mute">{hint}</p>
      </div>
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        multiple
        disabled={disabled || busy}
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
