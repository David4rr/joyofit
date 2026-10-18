import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Object3D,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { groundHeight } from "./terrain.ts";
import { ROAD_HALF, Track, makeTrackPoint, type TrackPoint } from "./track.ts";
import type { Theme, TreeKind } from "./theme.ts";

/** Deterministic PRNG so a route always grows the same trees. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paint(geometry: BufferGeometry, hex: number): BufferGeometry {
  const color = new Color(hex);
  const count = geometry.getAttribute("position").count;
  const data = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    data[i * 3] = color.r;
    data[i * 3 + 1] = color.g;
    data[i * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new BufferAttribute(data, 3));
  return geometry.index ? geometry.toNonIndexed() : geometry;
}

function at(geometry: BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): BufferGeometry {
  geometry.scale(sx, sy, sz);
  geometry.translate(x, y, z);
  return geometry;
}

function pineGeometry(): BufferGeometry {
  return mergeGeometries([
    paint(at(new CylinderGeometry(0.14, 0.2, 1.6, 5), 0, 0.8, 0), 0x5a3e2a),
    paint(at(new ConeGeometry(1.5, 3.2, 6), 0, 3.1, 0), 0x2f5d34),
    paint(at(new ConeGeometry(1.15, 2.8, 6), 0, 4.8, 0), 0x356b3a),
    paint(at(new ConeGeometry(0.75, 2.4, 6), 0, 6.3, 0), 0x3d7a42),
  ])!;
}

function roundGeometry(): BufferGeometry {
  return mergeGeometries([
    paint(at(new CylinderGeometry(0.16, 0.24, 2.4, 5), 0, 1.2, 0), 0x5e4630),
    paint(at(new IcosahedronGeometry(1.9, 0), 0, 3.9, 0, 1, 0.85, 1), 0x4c8a3c),
    paint(at(new IcosahedronGeometry(1.2, 0), 0.9, 3.2, 0.4), 0x5a9a46),
  ])!;
}

function palmGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [paint(at(new CylinderGeometry(0.12, 0.22, 6.5, 5), 0, 3.25, 0), 0x8a6a45)];
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const frond = new ConeGeometry(0.28, 3.2, 4);
    frond.rotateZ(Math.PI / 2 - 0.45);
    frond.translate(1.5, 0, 0);
    frond.rotateY(angle);
    frond.translate(0, 6.5, 0);
    parts.push(paint(frond, i % 2 ? 0x4f9a45 : 0x3f8a3d));
  }
  return mergeGeometries(parts)!;
}

function postGeometry(): BufferGeometry {
  return mergeGeometries([
    paint(at(new CylinderGeometry(0.07, 0.07, 1.0, 5), 0, 0.5, 0), 0xf2f0e8),
    paint(at(new CylinderGeometry(0.075, 0.075, 0.16, 5), 0, 0.82, 0), 0xc4382c),
  ])!;
}

function bushGeometry(): BufferGeometry {
  return paint(at(new IcosahedronGeometry(0.8, 0), 0, 0.45, 0, 1.2, 0.8, 1.2), 0x4a7d36);
}

function rockGeometry(): BufferGeometry {
  return paint(at(new IcosahedronGeometry(0.9, 0), 0, 0.4, 0, 1.3, 0.8, 1), 0x8c857a);
}

const GEOMETRIES: Record<TreeKind | "post" | "bush" | "rock", () => BufferGeometry> = {
  pine: pineGeometry,
  round: roundGeometry,
  palm: palmGeometry,
  post: postGeometry,
  bush: bushGeometry,
  rock: rockGeometry,
};

export class Scenery {
  readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly geometries = new Map<string, BufferGeometry>();
  private readonly point: TrackPoint = makeTrackPoint();
  private readonly dummy = new Object3D();
  private readonly tint = new Color();

  constructor(
    private readonly track: Track,
    private readonly theme: Theme,
    private readonly treeScale: number,
  ) {}

  private geometry(kind: keyof typeof GEOMETRIES): BufferGeometry {
    let g = this.geometries.get(kind);
    if (!g) {
      g = GEOMETRIES[kind]();
      this.geometries.set(kind, g);
    }
    return g;
  }

  /** Everything that grows beside the road between [s0, s1). */
  buildChunk(s0: number, s1: number, chunkIndex: number): Group {
    const group = new Group();
    const rand = mulberry32(this.theme.seed * 1009 + chunkIndex * 7919);
    const placements = new Map<string, Matrix4[]>();
    const tints = new Map<string, number[]>();
    const place = (kind: keyof typeof GEOMETRIES, s: number, lat: number, scale: number, tone: number, yawJitter = true) => {
      const t = this.track.at(s, this.point);
      const wx = t.x + Math.cos(t.yaw) * lat;
      const wz = t.z - Math.sin(t.yaw) * lat;
      const y = groundHeight(this.theme, t.y, lat, wx, wz);
      this.dummy.position.set(wx, y, wz);
      this.dummy.rotation.set(0, yawJitter ? rand() * Math.PI * 2 : t.yaw, 0);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      let list = placements.get(kind);
      if (!list) placements.set(kind, (list = []));
      list.push(this.dummy.matrix.clone());
      let tl = tints.get(kind);
      if (!tl) tints.set(kind, (tl = []));
      tl.push(tone);
    };

    const density = this.theme.treeDensity * this.treeScale;
    const lo = Math.max(s0, -40);
    const hi = Math.min(s1, this.track.lengthM + 300);

    for (let s = lo; s < hi; s += 25) {
      place("post", s, -(ROAD_HALF + 1.4), 1, 1, false);
      place("post", s, ROAD_HALF + 1.4, 1, 1, false);
    }

    for (const side of [-1, 1]) {
      const count = Math.round(((hi - lo) / 100) * density);
      for (let i = 0; i < count; i++) {
        const s = lo + rand() * (hi - lo);
        const depth = 8 + Math.pow(rand(), 1.6) * (this.theme.treeReach - 8);
        const lat = side * depth;
        if (this.theme.hasSea && lat > 22) continue;
        const kind = this.theme.trees[Math.floor(rand() * this.theme.trees.length)]!;
        place(kind, s, lat, 0.75 + rand() * 0.9, 0.82 + rand() * 0.3);
      }
      const bushes = Math.round(((hi - lo) / 100) * density * 0.8);
      for (let i = 0; i < bushes; i++) {
        const s = lo + rand() * (hi - lo);
        const depth = ROAD_HALF + 2.5 + rand() * 18;
        if (this.theme.hasSea && side > 0 && depth > 20) continue;
        const rocky = this.theme.hillAmp > 60 && rand() < 0.5;
        place(rocky ? "rock" : "bush", s, side * depth, 0.6 + rand() * 1.1, 0.85 + rand() * 0.3);
      }
    }

    for (const [kind, matrices] of placements) {
      const mesh = new InstancedMesh(this.geometry(kind as keyof typeof GEOMETRIES), this.material, matrices.length);
      const toneList = tints.get(kind)!;
      matrices.forEach((m, i) => {
        mesh.setMatrixAt(i, m);
        this.tint.setScalar(toneList[i]!);
        mesh.setColorAt(i, this.tint);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
    return group;
  }

  dispose(): void {
    for (const g of this.geometries.values()) g.dispose();
    this.material.dispose();
  }
}
