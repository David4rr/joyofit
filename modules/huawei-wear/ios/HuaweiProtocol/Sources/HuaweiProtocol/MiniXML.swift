// A small well-formedness-checking XML reader for a watch face's `description.xml`: elements, attributes, text, CDATA, comments, processing
// instructions and the five predefined and numeric character references. A DOCTYPE is refused (the Kotlin parser sets
// `disallow-doctype-decl`, so no entity can be declared). It exists so the package has no dependency on Foundation's XMLParser, which is a
// separate module on Linux. Not a general XML library: no namespaces, no DTD.
import Foundation

public struct MiniXMLError: Error, CustomStringConvertible {
    public let message: String
    public var description: String { message }
}

public final class MiniXMLElement {
    public let name: String
    public private(set) var children: [MiniXMLElement] = []
    /// Every text node below this element, in document order (DOM `textContent`).
    public private(set) var text = ""

    init(name: String) { self.name = name }

    fileprivate func add(child: MiniXMLElement) { children.append(child) }
    fileprivate func add(text: String) { self.text += text }

    /// The first element with this name in document order, this one included (DOM `getElementsByTagName(...).item(0)`).
    public func firstElement(named tag: String) -> MiniXMLElement? {
        if name == tag { return self }
        for child in children {
            if let found = child.firstElement(named: tag) { return found }
        }
        return nil
    }
}

public enum MiniXML {
    public static func parse(_ source: String) throws -> MiniXMLElement {
        var parser = Parser(Array(source.unicodeScalars))
        return try parser.document()
    }

    private struct Parser {
        let s: [Unicode.Scalar]
        var i = 0

        init(_ scalars: [Unicode.Scalar]) { s = scalars }

        func fail(_ message: String) -> MiniXMLError { MiniXMLError(message: "\(message) (at character \(i))") }

        func starts(_ literal: String) -> Bool {
            var j = i
            for u in literal.unicodeScalars {
                guard j < s.count, s[j] == u else { return false }
                j += 1
            }
            return true
        }

        mutating func skip(_ literal: String) { i += literal.unicodeScalars.count }

        func isSpace(_ u: Unicode.Scalar) -> Bool { u == " " || u == "\t" || u == "\n" || u == "\r" }

        mutating func skipSpace() { while i < s.count, isSpace(s[i]) { i += 1 } }

        func isNameStart(_ u: Unicode.Scalar) -> Bool {
            u == "_" || u == ":" || (u >= "a" && u <= "z") || (u >= "A" && u <= "Z") || u.value >= 0x80
        }

        func isNameChar(_ u: Unicode.Scalar) -> Bool { isNameStart(u) || u == "-" || u == "." || (u >= "0" && u <= "9") }

        mutating func name() throws -> String {
            guard i < s.count, isNameStart(s[i]) else { throw fail("a name is expected") }
            var out = String.UnicodeScalarView()
            while i < s.count, isNameChar(s[i]) {
                out.append(s[i])
                i += 1
            }
            return String(out)
        }

        mutating func document() throws -> MiniXMLElement {
            if starts("<?xml") && i + 5 < s.count && (isSpace(s[i + 5]) || s[i + 5] == "?") {
                try processingInstruction()
            }
            var root: MiniXMLElement?
            while true {
                skipSpace()
                guard i < s.count else { break }
                if starts("<!--") {
                    try comment()
                } else if starts("<?") {
                    try processingInstruction()
                } else if starts("<!DOCTYPE") {
                    throw fail("DOCTYPE is not allowed")
                } else if starts("<") {
                    guard root == nil else { throw fail("only one root element is allowed") }
                    root = try element()
                } else {
                    throw fail("content is not allowed outside the root element")
                }
            }
            guard let root else { throw fail("the document has no root element") }
            return root
        }

        mutating func comment() throws {
            skip("<!--")
            while i < s.count {
                if starts("--") {
                    guard starts("-->") else { throw fail("'--' is not allowed in a comment") }
                    skip("-->")
                    return
                }
                i += 1
            }
            throw fail("a comment is not closed")
        }

        mutating func processingInstruction() throws {
            skip("<?")
            let target = try name()
            if target.lowercased() == "xml" && i != 5 { throw fail("the xml declaration is only allowed at the start") }
            while i < s.count {
                if starts("?>") {
                    skip("?>")
                    return
                }
                i += 1
            }
            throw fail("a processing instruction is not closed")
        }

        mutating func element() throws -> MiniXMLElement {
            skip("<")
            let element = MiniXMLElement(name: try name())
            var seen = Set<String>()
            while true {
                let hadSpace = i < s.count && isSpace(s[i])
                skipSpace()
                guard i < s.count else { throw fail("an element is not closed") }
                if starts("/>") {
                    skip("/>")
                    return element
                }
                if starts(">") {
                    skip(">")
                    break
                }
                guard hadSpace else { throw fail("a space is expected between attributes") }
                let attribute = try name()
                guard seen.insert(attribute).inserted else { throw fail("attribute '\(attribute)' is repeated") }
                skipSpace()
                guard starts("=") else { throw fail("'=' is expected after attribute '\(attribute)'") }
                skip("=")
                skipSpace()
                guard i < s.count, s[i] == "\"" || s[i] == "'" else { throw fail("a quoted attribute value is expected") }
                let quote = s[i]
                i += 1
                while true {
                    guard i < s.count else { throw fail("an attribute value is not closed") }
                    if s[i] == quote {
                        i += 1
                        break
                    }
                    if s[i] == "<" { throw fail("'<' is not allowed in an attribute value") }
                    if s[i] == "&" { _ = try reference() } else { i += 1 }
                }
            }
            try content(of: element)
            return element
        }

        mutating func content(of element: MiniXMLElement) throws {
            while true {
                guard i < s.count else { throw fail("element '\(element.name)' is not closed") }
                if starts("</") {
                    skip("</")
                    let closing = try name()
                    guard closing == element.name else { throw fail("'</\(closing)>' does not close '<\(element.name)>'") }
                    skipSpace()
                    guard starts(">") else { throw fail("'>' is expected") }
                    skip(">")
                    return
                } else if starts("<!--") {
                    try comment()
                } else if starts("<![CDATA[") {
                    skip("<![CDATA[")
                    var out = String.UnicodeScalarView()
                    while true {
                        guard i < s.count else { throw fail("a CDATA section is not closed") }
                        if starts("]]>") {
                            skip("]]>")
                            break
                        }
                        out.append(s[i])
                        i += 1
                    }
                    element.add(text: String(out))
                } else if starts("<?") {
                    try processingInstruction()
                } else if starts("<!") {
                    throw fail("a declaration is not allowed here")
                } else if starts("<") {
                    element.add(child: try self.element())
                } else if s[i] == "&" {
                    element.add(text: try reference())
                } else {
                    var chunk = String.UnicodeScalarView()
                    while i < s.count, s[i] != "<", s[i] != "&" {
                        chunk.append(s[i])
                        i += 1
                    }
                    element.add(text: String(chunk))
                }
            }
        }

        /// A character or entity reference; only the five predefined entities exist.
        mutating func reference() throws -> String {
            skip("&")
            var body = ""
            while i < s.count, s[i] != ";" {
                guard body.unicodeScalars.count < 12, !isSpace(s[i]) else { throw fail("a reference is not terminated") }
                body.unicodeScalars.append(s[i])
                i += 1
            }
            guard i < s.count else { throw fail("a reference is not terminated") }
            i += 1
            switch body {
            case "lt": return "<"
            case "gt": return ">"
            case "amp": return "&"
            case "quot": return "\""
            case "apos": return "'"
            default:
                guard body.hasPrefix("#") else { throw fail("the entity '&\(body);' was referenced, but not declared") }
                let digits = body.dropFirst()
                let value = digits.hasPrefix("x") ? UInt32(digits.dropFirst(), radix: 16) : UInt32(digits, radix: 10)
                guard let value, let scalar = Unicode.Scalar(value) else { throw fail("the character reference '&\(body);' is invalid") }
                return String(Character(scalar))
            }
        }
    }
}
