import { D1_MAX_PARAMS, D1_MAX_STATEMENT_BYTES, D1_MAX_VALUE_BYTES } from "../src/d1";

/**
 * Wraps a D1 binding so a statement that production D1 refuses fails the test the same way. The local D1 already
 * refuses more than 100 parameters, statement text over 100 KB and long LIKE patterns, but it accepts values over 2 MB;
 * the parameter and text checks are repeated here with a clearer message and so they hold if the local engine changes.
 */
export function guardD1(db: D1Database): D1Database {
  const raw = new WeakMap<object, D1PreparedStatement>();
  const encoder = new TextEncoder();

  const checkValue = (value: unknown, index: number): void => {
    let bytes = 0;
    if (typeof value === "string") bytes = value.length * 3 > D1_MAX_VALUE_BYTES ? encoder.encode(value).byteLength : 0;
    else if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) bytes = value.byteLength;
    if (bytes > D1_MAX_VALUE_BYTES) throw new Error(`D1 limit: bound value ${index + 1} is ${bytes} bytes (max ${D1_MAX_VALUE_BYTES})`);
  };

  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const proxy: D1PreparedStatement = new Proxy(statement, {
      get(target, prop) {
        if (prop === "bind") {
          return (...values: unknown[]) => {
            if (values.length > D1_MAX_PARAMS) throw new Error(`D1 limit: ${values.length} bound parameters (max ${D1_MAX_PARAMS})`);
            values.forEach(checkValue);
            return wrap(target.bind(...values));
          };
        }
        const member = Reflect.get(target, prop, target) as unknown;
        return typeof member === "function" ? (member as (...args: unknown[]) => unknown).bind(target) : member;
      },
    });
    raw.set(proxy, statement);
    return proxy;
  };

  return new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => {
          const bytes = encoder.encode(sql).byteLength;
          if (bytes > D1_MAX_STATEMENT_BYTES) throw new Error(`D1 limit: statement text is ${bytes} bytes (max ${D1_MAX_STATEMENT_BYTES})`);
          return wrap(target.prepare(sql));
        };
      }
      if (prop === "batch") return (statements: D1PreparedStatement[]) => target.batch(statements.map((s) => raw.get(s) ?? s));
      const member = Reflect.get(target, prop, target) as unknown;
      return typeof member === "function" ? (member as (...args: unknown[]) => unknown).bind(target) : member;
    },
  });
}
