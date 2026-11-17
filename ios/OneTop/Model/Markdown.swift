import Foundation

/// An agent's reply in Markdown, read by the web dashboard's rules (agent/onetop/dist/conversation.js `markdown`),
/// so a reply reads the same on every screen: paragraphs keep their line breaks; headings, lists nested by indent
/// (with task boxes), quotes, fenced code, tables and rules; inline code, bold, italic, strike and http(s) links.
/// Nothing in a reply is run or looked up: these blocks and marks are all it can make, and only http(s) is a link.
enum Markdown {
    indirect enum Block: Equatable {
        /// Lines of one paragraph, drawn with their line breaks.
        case paragraph([Line])
        case heading(Int, Line)
        case list(List)
        case quote([Block])
        case code(String)
        /// The header and the rows, each row with as many cells as the header.
        case table([Line], [[Line]])
        case rule
    }

    struct List: Equatable {
        var ordered: Bool
        /// The number of the first item; following items count on from it, as in an HTML list.
        var start = 1
        var items: [Item]
    }

    struct Item: Equatable {
        var lines: [Line]
        /// Lists indented under the item.
        var lists: [List] = []
    }

    /// One line of text, as runs that each carry their marks.
    typealias Line = [Run]

    struct Run: Equatable {
        var text: String
        var bold = false, italic = false, strike = false, code = false
        var link: URL?

        func sameMarks(_ other: Run) -> Bool {
            bold == other.bold && italic == other.italic && strike == other.strike && code == other.code && link == other.link
        }
    }

    // The web's patterns. JavaScript's \w and \d are ASCII, so they are spelled out here.
    nonisolated(unsafe) private static let listLine = #/(\s*)([-*+]|[0-9]{1,3}[.)])\s+(.*)/#
    nonisolated(unsafe) private static let ruleLine = #/\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})/#
    nonisolated(unsafe) private static let fenceLine = #/\s*(`{3,}|~{3,})/#
    nonisolated(unsafe) private static let headingLine = #/\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*/#
    nonisolated(unsafe) private static let headingStart = #/\s{0,3}#{1,6}\s/#
    nonisolated(unsafe) private static let quoteStart = #/\s*>\s?/#
    nonisolated(unsafe) private static let splitLine = #/\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*/#

    static func blocks(_ text: String) -> [Block] {
        let lines = text.replacing("\r\n", with: "\n").replacing("\r", with: "\n").split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        var out: [Block] = [], i = 0
        func line(_ k: Int) -> String { k < lines.count ? lines[k] : "" }
        while i < lines.count {
            let l = lines[i]
            if blank(l) { i += 1; continue }
            if let fence = l.prefixMatch(of: fenceLine)?.1 {
                var body: [String] = []
                i += 1
                while i < lines.count && !trim(lines[i]).hasPrefix(fence) { body.append(lines[i]); i += 1 }
                i += 1
                out.append(.code(body.joined(separator: "\n")))
                continue
            }
            if let heading = l.wholeMatch(of: headingLine) {
                out.append(.heading(heading.1.count, inline(String(heading.2))))
                i += 1
                continue
            }
            if l.wholeMatch(of: ruleLine) != nil { out.append(.rule); i += 1; continue }
            if l.prefixMatch(of: quoteStart) != nil {
                var body: [String] = []
                while i < lines.count, let mark = lines[i].prefixMatch(of: quoteStart) { body.append(String(lines[i][mark.range.upperBound...])); i += 1 }
                out.append(.quote(blocks(body.joined(separator: "\n"))))
                continue
            }
            if table(l, line(i + 1)) {
                let head = cells(l)
                i += 2
                var rows: [[Line]] = []
                while i < lines.count && lines[i].contains("|") && !blank(lines[i]) {
                    let row = cells(lines[i])
                    rows.append(head.indices.map { inline($0 < row.count ? row[$0] : "") })
                    i += 1
                }
                out.append(.table(head.map(inline), rows))
                continue
            }
            if l.wholeMatch(of: listLine) != nil {
                // An item runs on over indented lines; a blank line between items keeps the list going.
                var entries: [Entry] = []
                while i < lines.count {
                    let x = lines[i]
                    if let item = x.wholeMatch(of: listLine), x.wholeMatch(of: ruleLine) == nil {
                        let mark = String(item.2), ordered = mark.first?.isNumber == true
                        let number = Int(mark.dropLast()) ?? 0
                        entries.append(Entry(indent: item.1.reduce(0) { $0 + ($1 == "\t" ? 2 : 1) }, ordered: ordered,
                                             number: number == 0 ? 1 : number, text: String(item.3)))
                        i += 1
                    } else if !blank(x) && x.prefixMatch(of: #/\s{2,}/#) != nil && !entries.isEmpty && x.prefixMatch(of: fenceLine) == nil {
                        entries[entries.count - 1].text += "\n" + trim(x)
                        i += 1
                    } else if blank(x) && line(i + 1).wholeMatch(of: listLine) != nil {
                        i += 1
                    } else {
                        break
                    }
                }
                out += lists(entries).map(Block.list)
                continue
            }
            var para: [String] = []
            while i < lines.count && !blank(lines[i]) && (para.isEmpty || !opens(lines[i], line(i + 1))) { para.append(trim(lines[i])); i += 1 }
            out.append(.paragraph(para.map(inline)))
        }
        return out
    }

    /// Inline marks in one line. Code spans and links are set aside first, so nothing inside them is marked
    /// again; bold, strike and italic are then marked around them, italic only where `*` or `_` stands apart
    /// from letters and digits, so snake_case and 2 * 3 stay as written.
    static func inline(_ text: String) -> Line {
        var kept: [Line] = []
        func hold(_ line: Line) -> String { kept.append(line); return "\0\(kept.count - 1)\0" }
        var s = text.replacing("\0", with: "")
        s = s.replacing(#/`([^`\n]+)`/#) { hold([Run(text: String($0.1), code: true)]) }
        s = s.replacing(#/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/#) { m in
            let label = runs(marked(String(m.1)), kept)
            guard let url = URL(string: String(m.2)) else { return hold(label) }
            return hold(label.map { var r = $0; r.link = url; return r })
        }
        s = s.replacing(#/https?:\/\/[^\s\x00"'<>]+/#) { m in
            let u = String(m.0), end = u.firstMatch(of: #/[.,;:!?)\]]+$/#).map { String($0.0) } ?? "", href = String(u.dropLast(end.count))
            return hold([Run(text: href, link: URL(string: href))]) + end
        }
        return runs(marked(s), kept)
    }

    // MARK: - Lists

    private struct Entry { var indent: Int, ordered: Bool, number: Int, text: String }

    /// Items into lists by indent: a deeper item opens a list under the item before it, a shallower one closes
    /// lists back to its depth, and a change between numbered and bulleted at one depth starts a new list.
    private static func lists(_ entries: [Entry]) -> [List] {
        var done: [List] = [], open: [(indent: Int, list: List)] = []
        func close() {
            let list = open.removeLast().list
            if open.isEmpty { done.append(list) } else { open[open.count - 1].list.items[open[open.count - 1].list.items.count - 1].lists.append(list) }
        }
        for e in entries {
            while let top = open.last, e.indent < top.indent { close() }
            let text = e.text.replacing(#/^\[([ xX])\]\s+/#, maxReplacements: 1) { $0.1 == " " ? "☐ " : "☑ " }
            let item = Item(lines: text.split(separator: "\n", omittingEmptySubsequences: false).map { inline(String($0)) })
            let fresh = List(ordered: e.ordered, start: e.ordered ? e.number : 1, items: [item])
            if let top = open.last, e.indent == top.indent {
                if top.list.ordered == e.ordered { open[open.count - 1].list.items.append(item) } else { close(); open.append((e.indent, fresh)) }
            } else {
                open.append((e.indent, fresh))
            }
        }
        while !open.isEmpty { close() }
        return done
    }

    // MARK: - Lines

    private static func trim(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }
    private static func blank(_ s: String) -> Bool { trim(s).isEmpty }

    private static func table(_ head: String, _ next: String) -> Bool {
        head.contains("|") && next.contains("-") && next.wholeMatch(of: splitLine) != nil
    }

    private static func cells(_ line: String) -> [String] {
        var t = Substring(trim(line))
        if t.hasPrefix("|") { t = t.dropFirst() }
        if t.hasSuffix("|") { t = t.dropLast() }
        return t.split(separator: "|", omittingEmptySubsequences: false).map { trim(String($0)) }
    }

    /// A line that starts another block ends a paragraph.
    private static func opens(_ line: String, _ next: String) -> Bool {
        line.prefixMatch(of: fenceLine) != nil || line.prefixMatch(of: headingStart) != nil || line.prefixMatch(of: quoteStart) != nil
            || line.wholeMatch(of: ruleLine) != nil || line.wholeMatch(of: listLine) != nil || table(line, next)
    }

    // MARK: - Marks

    /// Bold, strike and italic as the web marks them, each written as a \0-wrapped letter around the text
    /// (upper case opens, lower case closes) beside the \0-wrapped numbers of the spans set aside.
    private static func marked(_ s: String) -> String {
        s.replacing(#/\*\*(\S(?:[^*]*?\S)?)\*\*|__(\S(?:[^_]*?\S)?)__/#) { "\0B\0" + ($0.1 ?? $0.2 ?? "") + "\0b\0" }
            .replacing(#/~~(\S(?:[^~]*?\S)?)~~/#) { "\0S\0" + $0.1 + "\0s\0" }
            .replacing(#/(^|[^A-Za-z0-9_*])\*(\S(?:[^*\n]*?\S)?)\*(?![A-Za-z0-9_*])/#) { String($0.1) + "\0I\0" + $0.2 + "\0i\0" }
            .replacing(#/(^|[^A-Za-z0-9_])_(\S(?:[^_\n]*?\S)?)_(?![A-Za-z0-9_])/#) { String($0.1) + "\0I\0" + $0.2 + "\0i\0" }
    }

    /// Reads marked text back into runs, putting the spans set aside back in their places.
    private static func runs(_ s: String, _ kept: [Line]) -> Line {
        var line: Line = [], bold = 0, italic = 0, strike = 0
        func add(_ run: Run) {
            guard !run.text.isEmpty else { return }
            if let last = line.last, last.sameMarks(run) { line[line.count - 1].text += run.text } else { line.append(run) }
        }
        for (k, part) in s.split(separator: "\0", omittingEmptySubsequences: false).enumerated() {
            if k % 2 == 0 {
                add(Run(text: String(part), bold: bold > 0, italic: italic > 0, strike: strike > 0))
            } else if let n = Int(part), n < kept.count {
                for var run in kept[n] {
                    run.bold = run.bold || bold > 0; run.italic = run.italic || italic > 0; run.strike = run.strike || strike > 0
                    add(run)
                }
            } else {
                switch part {
                case "B": bold += 1
                case "b": bold = max(0, bold - 1)
                case "I": italic += 1
                case "i": italic = max(0, italic - 1)
                case "S": strike += 1
                case "s": strike = max(0, strike - 1)
                default: break
                }
            }
        }
        return line
    }
}
