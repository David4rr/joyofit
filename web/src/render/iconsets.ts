import { VALUE_TYPE } from "@joyofit/hwt";
import { fieldDef } from "@/model/fields";
import { newSprite, remember, type Sprite } from "./canvas";

/**
 * Image sets for enum fields: `images[v]` is what the watch shows when the value is `v`. Only enums whose meaning per index is
 * known can be drawn here; the weather types (248) are not, because the order of their 11 images is not.
 */
type DrawImage = (index: number, size: number, color: string) => Sprite;

/** Power Enum (54): 11 images, 0 to 100 percent in 10 percent steps. A battery with its bar filled to `index / 10`. */
function batteryLevel(index: number, size: number, color: string): Sprite {
  const px = Math.max(8, Math.round(size));
  const { sprite, ctx } = newSprite(px, px);
  ctx.scale(px / 24, px / 24);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.roundRect(2.5, 7, 16, 10, 2.5);
  ctx.stroke();
  if (index > 0) {
    ctx.beginPath();
    ctx.roundRect(5, 9.5, (11 * index) / 10, 5, 1);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(21.5, 10.5);
  ctx.lineTo(21.5, 13.5);
  ctx.stroke();
  return sprite;
}

const DRAW: Readonly<Record<number, DrawImage>> = { [VALUE_TYPE.powerEnum]: batteryLevel };

/** True when `renderIconSet` can draw every image of this enum. */
export function canDrawIconSet(id: number): boolean {
  return DRAW[id] !== undefined && fieldDef(id)?.iconSet !== undefined;
}

const cache = new Map<string, Sprite[]>();

export function renderIconSet(id: number, size: number, color: string): Sprite[] {
  const key = `${id}|${Math.round(size)}|${color}`;
  const hit = cache.get(key);
  if (hit) {
    remember(cache, key, hit);
    return hit;
  }
  const draw = DRAW[id];
  const count = fieldDef(id)?.iconSet?.count;
  if (!draw || count === undefined) throw new Error(`no image set for value type ${id}`);
  const images = Array.from({ length: count }, (_, i) => draw(i, size, color));
  remember(cache, key, images);
  return images;
}
