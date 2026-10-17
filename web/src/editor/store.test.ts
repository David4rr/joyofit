import { beforeEach, describe, expect, it } from "vitest";
import { emptyProject, newImage } from "@/model/defaults";
import { useEditor } from "./store";

function reset() {
  useEditor.setState({ project: emptyProject("t"), past: [], future: [], selectedId: null, lastEdit: null, dragging: false, dragOrigin: null });
}

describe("editor store", () => {
  beforeEach(reset);

  it("adds, selects, undoes and redoes", () => {
    const s = useEditor.getState();
    const before = s.project.elements.length;
    s.addElement("date");
    expect(useEditor.getState().project.elements).toHaveLength(before + 1);
    expect(useEditor.getState().selectedId).not.toBeNull();
    useEditor.getState().undo();
    expect(useEditor.getState().project.elements).toHaveLength(before);
    useEditor.getState().redo();
    expect(useEditor.getState().project.elements).toHaveLength(before + 1);
  });

  it("turns a burst of slider edits into one undo step", () => {
    const id = useEditor.getState().project.elements[1]!.id;
    for (let size = 70; size < 90; size++) useEditor.getState().updateElement(id, { size } as never, "size");
    expect(useEditor.getState().past).toHaveLength(1);
    useEditor.getState().undo();
    expect((useEditor.getState().project.elements[1] as { size: number }).size).toBe(72);
  });

  it("records a drag as one undo step", () => {
    const id = useEditor.getState().project.elements[1]!.id;
    const start = useEditor.getState().project.elements[1]!.x;
    useEditor.getState().beginDrag();
    for (let i = 1; i <= 10; i++) useEditor.getState().updateElement(id, { x: start + i });
    useEditor.getState().endDrag();
    expect(useEditor.getState().past).toHaveLength(1);
    useEditor.getState().undo();
    expect(useEditor.getState().project.elements[1]!.x).toBe(start);
  });

  it("keeps the background at the bottom and refuses to delete it", () => {
    const s = useEditor.getState();
    const bg = s.project.elements[0]!;
    s.removeElement(bg.id);
    expect(useEditor.getState().project.elements[0]!.type).toBe("background");
    const time = s.project.elements[1]!;
    s.reorder(time.id, 0);
    expect(useEditor.getState().project.elements[0]!.type).toBe("background");
  });

  it("reorders layers and duplicates with an offset", () => {
    const s = useEditor.getState();
    s.addCustom(newImage(null, 50, 50, { id: "img" }));
    s.moveInStack("img", -1);
    expect(useEditor.getState().project.elements.map((e) => e.id).indexOf("img")).toBe(1);
    useEditor.getState().duplicateElement("img");
    const copy = useEditor.getState().project.elements.find((e) => e.name === "Image copy")!;
    const orig = useEditor.getState().project.elements.find((e) => e.id === "img")!;
    expect(copy.x).toBe(orig.x + 12);
  });
});

describe("pointer gestures and history", () => {
  beforeEach(reset);

  it("a bare click on an element adds no undo step and keeps the redo stack", () => {
    const s = useEditor.getState();
    s.addElement("date");
    useEditor.getState().undo();
    expect(useEditor.getState().future).toHaveLength(1);
    const before = useEditor.getState();

    // What the stage does on a click: select, begin a gesture, release with no movement.
    const id = before.project.elements[1]!.id;
    useEditor.getState().select(id);
    useEditor.getState().beginDrag();
    useEditor.getState().endDrag();

    const after = useEditor.getState();
    expect(after.past).toHaveLength(before.past.length);
    expect(after.future).toHaveLength(1);
    expect(after.project).toBe(before.project);
  });

  it("a press that only reports the same position is not an edit either", () => {
    const id = useEditor.getState().project.elements[1]!;
    useEditor.getState().beginDrag();
    useEditor.getState().updateElement(id.id, { x: id.x, y: id.y });
    useEditor.getState().endDrag();
    expect(useEditor.getState().past).toHaveLength(0);
  });

  it("pushes the undo step on the first real movement, and only one for the whole gesture", () => {
    const el = useEditor.getState().project.elements[1]!;
    useEditor.getState().addElement("date");
    useEditor.getState().undo();
    const origin = useEditor.getState().project;
    expect(useEditor.getState().future).toHaveLength(1);

    useEditor.getState().beginDrag();
    expect(useEditor.getState().past).toHaveLength(0);
    for (let i = 1; i <= 5; i++) useEditor.getState().updateElement(el.id, { x: el.x + i });
    useEditor.getState().endDrag();

    const s = useEditor.getState();
    expect(s.past).toEqual([origin]);
    expect(s.future).toHaveLength(0);
    expect(s.project.elements[1]!.x).toBe(el.x + 5);
    useEditor.getState().undo();
    expect(useEditor.getState().project.elements[1]!.x).toBe(el.x);
  });

  it("treats panning a photo background the same way", () => {
    const bg = useEditor.getState().project.elements[0]!;
    useEditor.getState().updateElement(bg.id, { fill: { kind: "image", assetId: "a", zoom: 1, offsetX: 0, offsetY: 0, dim: 0 } } as never);
    const steps = useEditor.getState().past.length;
    useEditor.getState().beginDrag();
    useEditor.getState().endDrag();
    expect(useEditor.getState().past).toHaveLength(steps);
    useEditor.getState().beginDrag();
    useEditor.getState().updateElement(bg.id, { fill: { kind: "image", assetId: "a", zoom: 1, offsetX: 0.2, offsetY: 0, dim: 0 } } as never);
    useEditor.getState().endDrag();
    expect(useEditor.getState().past).toHaveLength(steps + 1);
  });
});
