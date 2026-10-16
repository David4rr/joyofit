// A small wrapper over the system sqlite3 C API: what SyncStore and the HealthKit exporter need, nothing more.
// Darwin ships SQLite3 as a system module; the Linux logic tests get the same C API from the `CSQLite` system library target.
import Foundation
#if canImport(SQLite3)
import SQLite3
#elseif canImport(CSQLite)
import CSQLite
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public struct SQLiteError: Error, CustomStringConvertible {
    public let code: Int32
    public let message: String

    public var description: String { "SQLite error \(code): \(message)" }
}

/// A bound parameter or a column value.
public enum SQLValue: Equatable {
    case int(Int64)
    case double(Double)
    case text(String)
    case null

    /// An `Int` (or NULL for nil) as a parameter.
    public static func integer(_ v: Int?) -> SQLValue { v.map { .int(Int64($0)) } ?? .null }
    public static func string(_ v: String?) -> SQLValue { v.map { .text($0) } ?? .null }
}

/// SQLITE_TRANSIENT: SQLite copies the bound bytes before `sqlite3_bind_text` returns.
private let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/// One prepared statement; `reset()` clears the bindings and rewinds it so a loop can reuse it.
public final class SQLiteStatement {
    fileprivate var handle: OpaquePointer?
    private unowned let owner: SQLiteDatabase

    fileprivate init(owner: SQLiteDatabase, sql: String) throws {
        self.owner = owner
        let code = sqlite3_prepare_v2(owner.handle, sql, -1, &handle, nil)
        if code != SQLITE_OK { throw owner.lastError(code) }
    }

    deinit { sqlite3_finalize(handle) }

    public func bind(_ values: [SQLValue]) throws {
        for (offset, value) in values.enumerated() {
            let index = Int32(offset + 1)
            let code: Int32
            switch value {
            case .int(let v): code = sqlite3_bind_int64(handle, index, v)
            case .double(let v): code = sqlite3_bind_double(handle, index, v)
            case .text(let v): code = sqlite3_bind_text(handle, index, v, -1, sqliteTransient)
            case .null: code = sqlite3_bind_null(handle, index)
            }
            if code != SQLITE_OK { throw owner.lastError(code) }
        }
    }

    /// Steps once; true while a row is available, false at the end.
    public func step() throws -> Bool {
        let code = sqlite3_step(handle)
        switch code {
        case SQLITE_ROW: return true
        case SQLITE_DONE: return false
        default: throw owner.lastError(code)
        }
    }

    public func reset() {
        sqlite3_reset(handle)
        sqlite3_clear_bindings(handle)
    }

    public func isNull(_ column: Int32) -> Bool { sqlite3_column_type(handle, column) == SQLITE_NULL }
    public func int64(_ column: Int32) -> Int64 { sqlite3_column_int64(handle, column) }
    public func int(_ column: Int32) -> Int { Int(sqlite3_column_int64(handle, column)) }
    public func double(_ column: Int32) -> Double { sqlite3_column_double(handle, column) }
    public func text(_ column: Int32) -> String? {
        guard let c = sqlite3_column_text(handle, column) else { return nil }
        return String(cString: c)
    }
    public func optionalInt(_ column: Int32) -> Int? { isNull(column) ? nil : int(column) }
}

/// A connection. Methods are not thread-safe: SyncStore serializes access.
public final class SQLiteDatabase {
    fileprivate var handle: OpaquePointer?

    /// Opens (and creates) the file. `busyTimeoutMs` is how long a statement waits for another connection (JS holds the file briefly
    /// while it migrates or writes).
    public init(path: String, busyTimeoutMs: Int32 = 10_000) throws {
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
        let code = sqlite3_open_v2(path, &handle, flags, nil)
        if code != SQLITE_OK {
            let error = SQLiteError(code: code, message: handle.map { String(cString: sqlite3_errmsg($0)) } ?? "cannot open \(path)")
            sqlite3_close(handle)
            handle = nil
            throw error
        }
        sqlite3_busy_timeout(handle, busyTimeoutMs)
    }

    deinit { sqlite3_close(handle) }

    fileprivate func lastError(_ code: Int32) -> SQLiteError {
        SQLiteError(code: code, message: handle.map { String(cString: sqlite3_errmsg($0)) } ?? "no connection")
    }

    /// Runs one or more statements without parameters.
    public func exec(_ sql: String) throws {
        var error: UnsafeMutablePointer<CChar>?
        let code = sqlite3_exec(handle, sql, nil, nil, &error)
        if code != SQLITE_OK {
            let message = error.map { String(cString: $0) } ?? "exec failed"
            sqlite3_free(error)
            throw SQLiteError(code: code, message: message)
        }
    }

    public func prepare(_ sql: String) throws -> SQLiteStatement { try SQLiteStatement(owner: self, sql: sql) }

    /// Rows the most recently completed INSERT, UPDATE or DELETE changed (`executeUpdateDelete`'s result on Android).
    public var changes: Int { Int(sqlite3_changes(handle)) }

    /// The rowid of the most recent successful INSERT on this connection.
    public var lastInsertRowId: Int64 { sqlite3_last_insert_rowid(handle) }

    /// Prepares, binds and runs a statement that returns no rows.
    public func run(_ sql: String, _ values: [SQLValue] = []) throws {
        let statement = try prepare(sql)
        try statement.bind(values)
        while try statement.step() {}
    }

    /// Prepares and binds `sql`, maps every row with `row`.
    public func query<T>(_ sql: String, _ values: [SQLValue] = [], _ row: (SQLiteStatement) throws -> T) throws -> [T] {
        let statement = try prepare(sql)
        try statement.bind(values)
        var out = [T]()
        while try statement.step() { out.append(try row(statement)) }
        return out
    }

    /// `BEGIN IMMEDIATE` ... `COMMIT`, rolled back when `body` throws (the Kotlin `beginTransaction`/`setTransactionSuccessful`).
    public func transaction<T>(_ body: () throws -> T) throws -> T {
        try exec("BEGIN IMMEDIATE")
        do {
            let result = try body()
            try exec("COMMIT")
            return result
        } catch {
            try? exec("ROLLBACK")
            throw error
        }
    }

    /// `PRAGMA user_version`: the number of migrations applied.
    public var userVersion: Int {
        get throws {
            let rows = try query("PRAGMA user_version") { $0.int(0) }
            return rows.first ?? 0
        }
    }

    public func setUserVersion(_ version: Int) throws {
        try exec("PRAGMA user_version = \(version)")
    }

    public func tableExists(_ name: String) throws -> Bool {
        try !query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [.text(name)]) { _ in true }.isEmpty
    }
}

#endif
