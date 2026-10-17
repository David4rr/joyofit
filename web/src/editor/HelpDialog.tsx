import { Dialog } from "@/ui/dialog";
import { Button } from "@/ui/button";
import { SHORTCUTS } from "./shortcuts";

const STEPS = [
  { title: "Design the face here", body: "Start from a template or an empty face. Add time, date, hands, data and rings, and check them against the simulated watch. The Photo face preview on the stage shows what a photo face keeps." },
  { title: "Export the photo face", body: "Press Export, keep Photo face selected, read the checklist, then download the PNG. It is 408 × 480 and holds the pictures only: background and images." },
  { title: "Move it to your phone", body: "Send the file to the phone that runs JoyoFit: cloud drive, cable or any messenger." },
  { title: "Pick it in JoyoFit", body: "Open JoyoFit, go to Watch, then Photo face, and pick the PNG. A picture of exactly 408 × 480 is uploaded without cropping." },
];

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Make a face for your Watch Fit 4"
      description="JoyoFit Studio draws the face in your browser and exports a photo-face picture for JoyoFit, and a Huawei .hwt file for Huawei's own tools. Nothing is uploaded."
      className="max-w-2xl"
      testId="help-dialog"
      footer={
        <Button onClick={onClose} data-testid="help-start">
          Start designing
        </Button>
      }
    >
      <ol className="space-y-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/12 text-sm font-bold text-primary tabular-nums">{i + 1}</span>
            <div>
              <p className="text-sm font-bold">{s.title}</p>
              <p className="text-[0.8125rem] text-muted-foreground">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 rounded-2xl bg-warning-soft p-4 text-[0.8125rem] leading-relaxed">
        <p className="font-bold">Unofficial and early</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-4">
          <li>
            These faces are not made, signed or endorsed by Huawei, and the watch only keeps a watch face Huawei signed: the Fit 4 Pro deletes an unsigned{" "}
            <span className="font-semibold">.hwt</span> about 3 seconds after it is activated. The .hwt export stays for Huawei Theme Studio Pro with a developer
            account and for inspecting the file. The photo face is the output that works with JoyoFit.
          </li>
          <li>A photo face is only a picture. The watch draws its own clock and data over it, so Studio's live layers are left out of the PNG.</li>
          <li>Only the Watch Fit 4 and Fit 4 Pro (408 × 480) are supported for now.</li>
          <li>
            For the .hwt, some elements are marked <span className="font-semibold">Preview only</span> or <span className="font-semibold">Unconfirmed on a watch</span>.
            Preview only elements are never written. Unconfirmed ones use ids read from sample faces and are written only if you leave that switch on in the export dialog.
          </li>
          <li>The watch can be set back to a built-in face from the Watch faces screen in JoyoFit.</li>
        </ul>
      </div>

      <h3 className="mt-5 mb-2 text-sm font-bold">Keyboard</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[0.8125rem]">
        {SHORTCUTS.map((s) => (
          <div key={s.keys} className="contents">
            <dt className="font-mono text-xs font-semibold text-foreground/80">{s.keys}</dt>
            <dd className="text-muted-foreground">{s.action}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
