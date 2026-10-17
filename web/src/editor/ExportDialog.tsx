import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Download, FileJson, FileSearch, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { hwtFileName } from "@/model/defaults";
import { downloadBlob, serializeProject } from "@/model/projectFile";
import type { Project, Sim } from "@/model/types";
import { SCREEN_H, SCREEN_W } from "@/model/types";
import { buildHwt, type ExportResult } from "@/export/build";
import { buildPhotoFace, type PhotoFaceResult } from "@/export/photo";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { Segmented } from "@/ui/surface";
import { Switch } from "@/ui/switch";
import { cn } from "@/ui/utils";

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

type Target = "photo" | "hwt";
type State<T> = { status: "building" } | { status: "ready"; result: T } | { status: "failed"; message: string };

function Check({ ok, children, detail }: { ok: "ok" | "warn" | "error"; children: React.ReactNode; detail?: React.ReactNode }) {
  const Icon = ok === "ok" ? CircleCheck : ok === "warn" ? TriangleAlert : CircleAlert;
  return (
    <li className="flex gap-3 py-2">
      <Icon className={cn("mt-0.5 size-[1.125rem] shrink-0", ok === "ok" && "text-battery", ok === "warn" && "text-warning", ok === "error" && "text-destructive")} />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{children}</p>
        {detail && <p className="text-[0.8125rem] text-muted-foreground">{detail}</p>}
      </div>
    </li>
  );
}

function Failed({ message }: { message: string }) {
  return (
    <div className="flex gap-2.5 rounded-2xl bg-destructive/10 p-3 text-sm" role="alert">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
      <p>
        <span className="font-bold">The face could not be built.</span> {message}
      </p>
    </div>
  );
}

function Building({ what }: { what: string }) {
  return (
    <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> {what}
    </p>
  );
}

/** Builds on open and whenever the project or the simulated state changes; resolves to the state of the latest build. */
function useBuild<T>(enabled: boolean, build: () => Promise<T>, deps: unknown[]): State<T> {
  const [state, setState] = useState<State<T>>({ status: "building" });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setState({ status: "building" });
    build().then(
      (result) => alive && setState({ status: "ready", result }),
      (err: unknown) => alive && setState({ status: "failed", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      alive = false;
    };
    // `build` closes over `deps`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
  return state;
}

function PhotoChecklist({ result, renamed }: { result: PhotoFaceResult; renamed: boolean }) {
  const included = result.layers.filter((l) => l.included);
  const problems = result.layers.filter((l) => !l.included && l.detail && !result.liveLeftOut.includes(l.name));
  const flagged = result.layers.filter((l) => l.included && l.detail);
  return (
    <ul className="divide-y divide-border" data-testid="checklist">
      <Check ok="ok" detail="Exactly the watch's screen, so JoyoFit uploads it as it is, without cropping or resampling.">
        Size {result.width} × {result.height}
      </Check>
      <Check ok={renamed ? "warn" : "ok"} detail={renamed ? "Spaces and symbols are dropped from the name." : undefined}>
        File name {result.fileName}
      </Check>
      <Check ok="ok" detail="The watch's photo face has no transparency. Layers are laid onto black and any transparent pixels become black; no rounded-corner mask is applied, the watch masks its own screen.">
        Opaque picture, transparency flattened onto black
      </Check>
      <Check
        ok="ok"
        detail={included.length > 0 ? included.map((l) => l.name).join(", ") : "Nothing but the black screen."}
      >
        {included.length} picture {included.length === 1 ? "layer" : "layers"} in the file
      </Check>
      {result.liveLeftOut.length > 0 ? (
        <Check
          ok="warn"
          detail={`${result.liveLeftOut.join(", ")}. The watch draws its own clock and data over a photo face (style, colour and position are set on the watch), so Studio's live layers cannot be part of the picture. Use the Photo face preview on the stage to see what is left.`}
        >
          {result.liveLeftOut.length} live {result.liveLeftOut.length === 1 ? "layer" : "layers"} left out
        </Check>
      ) : (
        <Check ok="ok" detail="Time, date, hands, data and rings are not part of a photo face.">
          No live layers to leave out
        </Check>
      )}
      {problems.map((l) => (
        <Check key={l.id} ok="warn" detail={l.detail}>
          {l.name} left out
        </Check>
      ))}
      {flagged.map((l) => (
        <Check key={l.id} ok="warn" detail={l.detail}>
          {l.name}
        </Check>
      ))}
      <Check ok="ok" detail="Send the PNG to your phone, then open JoyoFit, Watch, Photo face and pick it.">
        How to install
      </Check>
    </ul>
  );
}

function HwtChecklist({ result, renamed }: { result: ExportResult; renamed: boolean }) {
  const experimental = result.elements.filter((e) => e.exported && e.level === "experimental");
  const left = result.elements.filter((e) => !e.exported);
  const partial = result.elements.filter((e) => e.exported && e.dropped.length > 0);
  return (
    <ul className="divide-y divide-border" data-testid="checklist">
      <Check
        ok="warn"
        detail="The firmware needs Huawei's signature on a face. The Fit 4 Pro (6.1.0.117) answered activation of an unsigned face with status 100014 and deleted it about 3 seconds later. Keep this file for Huawei Theme Studio Pro with a Huawei developer account, or to inspect it. For a face that works with JoyoFit, use Photo face."
      >
        An unsigned .hwt is deleted by the watch
      </Check>
      <Check ok="ok" detail={`Watch Fit 4 and Fit 4 Pro, screen code HWHD13.`}>
        Resolution {SCREEN_W} × {SCREEN_H}
      </Check>
      <Check ok={renamed ? "warn" : "ok"} detail={renamed ? "Spaces and symbols are dropped from the name, as Huawei requires." : undefined}>
        File name {result.fileName}
      </Check>
      <Check ok={result.stats.images > 200 ? "warn" : "ok"} detail="The ten sample faces for this watch hold 44 to 164 images and weigh 154 to 448 KB.">
        {result.stats.images} images, {kb(result.stats.totalBytes)} in total
      </Check>
      <Check
        ok={result.notes.some((n) => n.text.includes("limit") && n.level === "error") ? "error" : "ok"}
        detail="Huawei Theme Studio limits: 750 KB per image, 4 MB image memory, 10 MB package."
      >
        Largest image {kb(result.stats.largestImageBytes)}, image memory {kb(result.stats.imageMemoryBytes)}
      </Check>
      <Check ok="ok" detail="Black screen with the time, date and the hour and minute hands at 45 percent brightness. Seconds, data and rings are not shown.">
        Always-on display
      </Check>
      {left.map((e) => (
        <Check key={e.id} ok="warn" detail={e.detail}>
          {e.name} left out
        </Check>
      ))}
      {experimental.map((e) => (
        <Check key={e.id} ok="warn" detail={e.detail}>
          {e.name} uses unconfirmed ids
        </Check>
      ))}
      {partial.map((e) => (
        <Check key={e.id} ok="warn" detail={`Preview only, not written: ${e.dropped.join(", ")}.`}>
          {e.name}: part of it is preview only
        </Check>
      ))}
      {result.notes
        .filter((n) => !n.text.startsWith("Huawei limit"))
        .map((n) => (
          <Check key={n.text} ok={n.level === "error" ? "error" : n.level === "warning" ? "warn" : "ok"}>
            {n.text}
          </Check>
        ))}
      {result.notes
        .filter((n) => n.text.startsWith("Huawei limit"))
        .map((n) => (
          <Check key={n.text} ok="error">
            {n.text}
          </Check>
        ))}
      <Check ok="warn" detail="Not tried on a watch: how single-digit hours and days are padded, the stacking order between different element types, and how the watch places a sign glyph (the degree sign of a temperature).">
        Layout details unconfirmed on a watch
      </Check>
    </ul>
  );
}

export function ExportDialog({ open, onClose, project, sim }: { open: boolean; onClose: () => void; project: Project; sim: Sim }) {
  const [target, setTarget] = useState<Target>("photo");
  const [includeExperimental, setIncludeExperimental] = useState(true);

  const photo = useBuild(open && target === "photo", () => buildPhotoFace(project, sim), [project, sim]);
  const hwt = useBuild(open && target === "hwt", () => buildHwt(project, sim, { includeExperimental }), [project, sim, includeExperimental]);

  const fileBase = hwtFileName(project.name);
  const renamed = fileBase !== project.name.trim();
  const photoResult = photo.status === "ready" ? photo.result : null;
  const hwtResult = hwt.status === "ready" ? hwt.result : null;
  const hwtBlocked = !hwtResult || hwtResult.notes.some((n) => n.level === "error");

  const downloadPhoto = () => {
    if (!photoResult) return;
    downloadBlob(photoResult.fileName, photoResult.png, "image/png");
    toast.success(`${photoResult.fileName} downloaded`, { description: "Send it to your phone, then JoyoFit: Watch, Photo face." });
  };
  const downloadHwt = () => {
    if (!hwtResult) return;
    downloadBlob(hwtResult.fileName, hwtResult.bytes, "application/octet-stream");
    toast.success(`${hwtResult.fileName} downloaded`, { description: "Unsigned: the watch deletes it unless Huawei signed it. Use it for Theme Studio Pro or to inspect it." });
  };
  const downloadDebug = () => {
    if (!hwtResult) return;
    downloadBlob(`${fileBase}.layout.json`, JSON.stringify(hwtResult.debug, null, 2), "application/json");
  };
  const downloadProject = async () => {
    downloadBlob(`${fileBase}.project.json`, await serializeProject(project), "application/json");
  };

  const experimental = hwtResult?.elements.filter((e) => e.exported && e.level === "experimental") ?? [];
  const state = target === "photo" ? photo : hwt;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Export checklist"
      description="Read this before you download. The numbers are from the file that will be written."
      className="max-w-xl"
      testId="export-dialog"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => void downloadProject()} data-testid="export-project-json">
            <FileJson /> Project JSON
          </Button>
          {target === "hwt" && (
            <Button variant="ghost" size="sm" onClick={downloadDebug} disabled={!hwtResult} data-testid="export-debug">
              <FileSearch /> Debug layout
            </Button>
          )}
          {target === "photo" ? (
            <Button onClick={downloadPhoto} disabled={!photoResult} data-testid="download-photo">
              {photo.status === "building" ? <Loader2 className="animate-spin" /> : <Download />}
              Download photo face PNG
            </Button>
          ) : (
            <Button onClick={downloadHwt} disabled={hwtBlocked} data-testid="download-hwt">
              {hwt.status === "building" ? <Loader2 className="animate-spin" /> : <Download />}
              Download .hwt
            </Button>
          )}
        </>
      }
    >
      <Segmented
        label="Export target"
        value={target}
        onChange={setTarget}
        className="mb-3"
        options={[
          { value: "photo", label: "Photo face (JoyoFit)" },
          { value: "hwt", label: ".hwt (needs Huawei's signature)" },
        ]}
      />
      {state.status === "failed" && <Failed message={state.message} />}
      {state.status === "building" && <Building what={target === "photo" ? "Flattening the picture layers..." : "Rendering sprites and writing the package..."} />}
      {target === "photo" && photoResult && <PhotoChecklist result={photoResult} renamed={renamed} />}
      {target === "hwt" && hwtResult && (
        <>
          <HwtChecklist result={hwtResult} renamed={renamed} />
          <div className="mt-3 flex items-center justify-between gap-4 rounded-2xl bg-muted p-4">
            <div className="min-w-0">
              <p className="text-sm font-bold">Include unconfirmed elements</p>
              <p className="text-[0.8125rem] text-muted-foreground" data-testid="experimental-summary">
                {experimental.length > 0
                  ? `${experimental.map((e) => e.name).join(", ")} use ids inferred from sample faces.`
                  : "The hour and minute hands, the seconds digits and the inferred data fields (altitude ring, battery level icons) use ids inferred from sample faces."}
              </p>
            </div>
            <Switch label="Include unconfirmed elements" checked={includeExperimental} onCheckedChange={setIncludeExperimental} />
          </div>
        </>
      )}
    </Dialog>
  );
}
